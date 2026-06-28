// cloudfunctions/hrListEmployees/index.js
//
// 用途：HR 列出所有员工。
// 入参：{}
// 返回：
//   { ok: true, list: [{ _id, name, dept, role, active, activatedAt, openid }] }
//   { ok: false, code: 'FORBIDDEN'|'NO_OPENID'|'DB_ERROR', message }
//
// 注意：返回 openid 是因为 HR 需要看哪个员工对应哪个微信号（避免重名）。
//      非 HR 调用一律 FORBIDDEN。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 守卫：当前用户必须是 HR
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
    const res = await db.collection('employees')
      .orderBy('activatedAt', 'desc')
      .limit(500)
      .get()
    const list = (res.data || []).map(e => ({
      _id: e._id,
      name: e.name || '',
      dept: e.dept || '',
      role: e.role || 'employee',
      active: e.active !== false,
      activatedAt: e.activatedAt || null,
      openid: e.openid || ''
    }))
    return { ok: true, list, total: list.length }
  } catch (err) {
    console.error('[hrListEmployees] DB error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
