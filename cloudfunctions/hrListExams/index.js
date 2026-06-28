// cloudfunctions/hrListExams/index.js
//
// 用途：HR 列出一级试卷（exam 集合）。仅返回 _id + name，供新建/编辑题库时挑选 pid 用。
//
// 入参：{}
// 返回：{ ok, list: [{_id, name}], total }

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

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const g = await requireHr(OPENID)
  if (g.err) return g.err

  try {
    const r = await db.collection('exam').limit(200).get()
    const list = (r.data || []).map(x => ({ _id: x._id, name: x.name || x._id }))
    return { ok: true, list, total: list.length }
  } catch (err) {
    console.error('[hrListExams] error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
