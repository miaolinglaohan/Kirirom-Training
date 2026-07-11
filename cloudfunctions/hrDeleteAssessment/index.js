// cloudfunctions/hrDeleteAssessment/index.js
//
// 用途：HR 删除考试及其所有关联数据。
//
// 级联删除：
//   1. examEnrollments（答卷快照）where assessmentId == _id
//   2. historys（历史成绩）where assessmentId == _id
//   3. assessments（考试自身）
//
// 入参：{ _id: string }
// 返回：{ ok, deletedAssessment, deletedEnrollments, deletedHistorys }
//
// 安全约束：
//   - 调用者必须是 HR 或 admin
//   - 只允许删除已截止（expired / endedAt）的考试
//   - 进行中/候考中的考试拒绝删除

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function requireHr(OPENID) {
  if (!OPENID) return { err: { ok: false, code: 'NO_OPENID', message: '无法获取微信身份' } }
  const r = await db.collection('employees').where({ openid: OPENID }).limit(1).get()
  const me = r.data[0]
  if (!me || me.active === false || (me.role !== 'hr' && me.role !== 'admin')) {
    return { err: { ok: false, code: 'FORBIDDEN', message: '没有 HR 权限' } }
  }
  return { me }
}

// 批量删除集合中匹配条件的记录（每次最多 100 条，循环直到清空）
async function batchDelete(collection, where) {
  let deleted = 0
  while (true) {
    const res = await db.collection(collection).where(where).limit(100).get()
    if (!res.data || res.data.length === 0) break
    const ids = res.data.map(d => d._id)
    // 逐条删除（云数据库没有 batchRemove）
    for (const id of ids) {
      await db.collection(collection).doc(id).remove()
    }
    deleted += ids.length
  }
  return deleted
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const g = await requireHr(OPENID)
  if (g.err) return g.err

  const _id = String(event._id || '').trim()
  if (!_id) return { ok: false, code: 'MISSING_ID', message: '缺少考试 ID' }

  try {
    const asRes = await db.collection('assessments').doc(_id).get().catch(() => null)
    if (!asRes || !asRes.data) {
      return { ok: false, code: 'NOT_FOUND', message: '考试不存在' }
    }
    const a = asRes.data

    // 只允许删除已结束的考试
    const now = Date.now()
    const startMs = new Date(a.startTime || 0).getTime()
    const validHours = Number(a.validHours) || 0
    const validUntil = validHours > 0
      ? startMs + validHours * 60 * 60 * 1000
      : startMs + (a.duration || 0) * 60 * 1000
    // endedAt 优先
    const endedMs = a.endedAt ? new Date(a.endedAt).getTime() : 0
    const effectiveUntil = (endedMs > 0 && endedMs < validUntil) ? endedMs : validUntil

    if (now <= effectiveUntil) {
      return { ok: false, code: 'NOT_EXPIRED', message: '只能删除已结束的考试' }
    }

    // 统计 + 级联删除
    const name = a.name || _id

    // 1. 删除 examEnrollments
    const deletedEnrollments = await batchDelete('examEnrollments', { assessmentId: _id })

    // 2. 删除 historys
    const deletedHistorys = await batchDelete('historys', { assessmentId: _id })

    // 3. 删除 assessments 自身
    await db.collection('assessments').doc(_id).remove()

    return {
      ok: true,
      deletedAssessment: name,
      deletedEnrollments,
      deletedHistorys
    }
  } catch (err) {
    console.error('[hrDeleteAssessment] error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
