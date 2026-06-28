// cloudfunctions/hrDeleteQuestion/index.js
//
// 用途：HR 删除一道题目。
//
// 说明：不级联检查 examEnrollments —— 因为 enterExam 在抽题时已把题目快照写进
//   enrollment.questions 数组（含选项内容），删题不影响已进场的考卷判分。
//
// 入参：{ _id: string }
// 返回：{ ok } 或 { ok:false, code, message }

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
  if (!_id) return { ok: false, code: 'MISSING_ID', message: '缺少题目 _id' }

  try {
    const ex = await db.collection('questions').where({ _id }).limit(1).get()
    if (!ex.data || ex.data.length === 0) {
      return { ok: false, code: 'NOT_FOUND', message: '题目不存在' }
    }
    await db.collection('questions').doc(_id).remove()
    return { ok: true, _id }
  } catch (err) {
    console.error('[hrDeleteQuestion] error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
