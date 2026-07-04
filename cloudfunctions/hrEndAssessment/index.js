// cloudfunctions/hrEndAssessment/index.js
//
// 用途：HR 提前结束考试。
//
// 场景：考试原设有效期 48h，但 HR 想提前关闭（比如已到下班点、或临时改期）。
//       点击"结束"按钮 → 考试立即变为已截止，员工无法再进场。
//
// 实现：新增 endedAt 字段 = 当前时刻。所有读 validUntil 的地方（listMyAssessments /
//       enterExam / hrListAssessments）对 endedAt 取 min，即：
//         effectiveValidUntil = min(originalValidUntil, endedAt)
//       endedAt 写入后，originalValidHours 保留不变（审计用）。
//
// 入参：{ _id: string }
// 返回：{ ok: true, endedAt }
//       { ok: false, code, message }
//
// 错误码：NO_OPENID / FORBIDDEN / MISSING_ID / NOT_FOUND / ALREADY_ENDED / DB_ERROR

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
  if (!_id) return { ok: false, code: 'MISSING_ID', message: '缺少考试 ID' }

  try {
    const asRes = await db.collection('assessments').doc(_id).get().catch(() => null)
    if (!asRes || !asRes.data) {
      return { ok: false, code: 'NOT_FOUND', message: '考试不存在' }
    }
    const a = asRes.data
    const now = Date.now()

    // 已结束过：endedAt 已存在则不允许重复操作
    if (a.endedAt && new Date(a.endedAt).getTime() <= now) {
      return { ok: false, code: 'ALREADY_ENDED', message: '该考试已提前结束过' }
    }

    await db.collection('assessments').doc(_id).update({
      data: {
        endedAt: new Date(now),
        endedBy: g.me._id
      }
    })

    return { ok: true, endedAt: now }
  } catch (err) {
    console.error('[hrEndAssessment] error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
