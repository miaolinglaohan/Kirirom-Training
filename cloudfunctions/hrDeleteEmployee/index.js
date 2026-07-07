// cloudfunctions/hrDeleteEmployee/index.js
//
// 用途：HR 删除员工白名单记录。
//
// 只删 employees 集合中的记录，不删 historys / examEnrollments（历史成绩保留）。
// 删除后该微信用户无法再登录（whoAmI 查不到记录），如需恢复需重新录入白名单。
//
// 入参：{ _id: string }
// 返回：{ ok: true } 或 { ok: false, code, message }
//
// 安全约束：
//   - 调用者必须是 HR 或 admin
//   - 不允许删除自己
//   - 不允许删除 admin 超管（保护超管层级）

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
  const me = g.me

  const targetId = String(event._id || '').trim()
  if (!targetId) return { ok: false, code: 'MISSING_ID', message: '缺少员工 _id' }

  // 不允许删除自己
  if (String(targetId) === String(me._id)) {
    return { ok: false, code: 'SELF_LOCK', message: '不能删除自己' }
  }

  try {
    const tr = await db.collection('employees').doc(targetId).get()
    const target = tr.data
    if (!target) return { ok: false, code: 'NOT_FOUND', message: '员工不存在' }

    // 保护 admin 超管
    if (target.role === 'admin') {
      return { ok: false, code: 'PROTECTED', message: '超管账号请在云开发控制台删除' }
    }

    await db.collection('employees').doc(targetId).remove()

    return {
      ok: true,
      deletedName: target.name || '',
      message: '已删除白名单记录，历史成绩保留'
    }
  } catch (err) {
    console.error('[hrDeleteEmployee] error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
