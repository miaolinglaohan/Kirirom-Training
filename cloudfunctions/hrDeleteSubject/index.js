// cloudfunctions/hrDeleteSubject/index.js
//
// 用途：HR 删除题库（subjects），级联删除其下所有题目（questions where examid=_id）。
//
// 安全约束：
//   - 被 assessments 引用（subjectId = 该题库 _id）时拒绝删除，返回 BLOCKED_BY_ASSESSMENT
//     并附带占用列表（detail: [{_id, name}]），由 HR 先迁移或删除考试再来
//   - 通过校验则：先删 questions（按 examid 批量），再删 subjects.doc(_id)
//
// 入参：{ _id: string }
// 返回：{ ok, deletedQuestions, deletedSubject } 或 { ok:false, code, message, detail? }

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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const g = await requireHr(OPENID)
  if (g.err) return g.err

  const _id = String(event._id || '').trim()
  if (!_id) return { ok: false, code: 'MISSING_ID', message: '缺少题库 _id' }

  // 检查 assessments 引用
  try {
    const ar = await db.collection('assessments').where({ subjectId: _id }).limit(20).get()
    if (ar.data && ar.data.length > 0) {
      return {
        ok: false,
        code: 'BLOCKED_BY_ASSESSMENT',
        message: '该题库正被考试引用，请先删除或修改这些考试',
        detail: ar.data.map(a => ({ _id: a._id, name: a.name || '' }))
      }
    }
  } catch (err) {
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }

  // 题库存在性
  try {
    const sr = await db.collection('subjects').where({ _id }).limit(1).get()
    if (!sr.data || sr.data.length === 0) {
      return { ok: false, code: 'NOT_FOUND', message: '题库不存在' }
    }
  } catch (err) {
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }

  // 级联删除题目：批量 remove；wx 数据库 batch remove 一次最多 1000 条，超过分批
  let deletedQuestions = 0
  try {
    while (true) {
      const r = await db.collection('questions').where({ examid: _id }).remove()
      const removed = (r.stats && r.stats.removed) || 0
      deletedQuestions += removed
      if (removed === 0 || removed < 100) break  // 已删完或剩余少量也一次删干净
    }
  } catch (err) {
    console.error('[hrDeleteSubject] remove questions', err)
    return { ok: false, code: 'DB_ERROR', message: '删除题目失败：' + (err.errMsg || String(err)) }
  }

  // 删除题库本身
  try {
    await db.collection('subjects').doc(_id).remove()
  } catch (err) {
    console.error('[hrDeleteSubject] remove subject', err)
    return {
      ok: false,
      code: 'DB_ERROR',
      message: '题目已删除但题库本体删除失败：' + (err.errMsg || String(err)),
      deletedQuestions
    }
  }

  return { ok: true, deletedQuestions, deletedSubject: _id }
}
