// cloudfunctions/hrSetEmployee/index.js
//
// 用途：HR 修改某员工的 role / active / dept 字段。
//
// 入参：
//   { _id: string, patch: { role?: 'hr'|'employee', active?: boolean, dept?: string } }
//
// 返回：
//   { ok: true, updated: {...} }
//   { ok: false, code, message }
//
// 安全约束：
//   - 调用者必须是 HR
//   - 不允许 HR 把自己的 role 改成非 hr（避免后台彻底锁死，必须再有别人来恢复）
//   - 不允许 HR 把自己 active 改成 false（同上）
//   - role 只接受 'hr' 或 'employee' 两个值；其它值原样落库会让 whoAmI 判定为普通员工但容易混乱，直接拒绝

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function requireHr(OPENID) {
  if (!OPENID) return { err: { ok: false, code: 'NO_OPENID', message: '无法获取微信身份' } }
  const r = await db.collection('employees').where({ openid: OPENID }).limit(1).get()
  const me = r.data[0]
  if (!me || me.active === false || me.role !== 'hr') {
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
  const patch = event.patch || {}
  if (!targetId) return { ok: false, code: 'MISSING_ID', message: '缺少员工 _id' }

  // 校验 patch 字段白名单
  const update = {}
  if (Object.prototype.hasOwnProperty.call(patch, 'role')) {
    if (patch.role !== 'hr' && patch.role !== 'employee') {
      return { ok: false, code: 'INVALID_ROLE', message: 'role 只允许 hr / employee' }
    }
    update.role = patch.role
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'active')) {
    update.active = !!patch.active
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'dept')) {
    update.dept = String(patch.dept || '').trim()
  }
  if (Object.keys(update).length === 0) {
    return { ok: false, code: 'EMPTY_PATCH', message: '没有要更新的字段' }
  }

  // 防自锁：HR 不能取消自己的 HR 资格 / 不能停用自己
  if (String(targetId) === String(me._id)) {
    if (update.role === 'employee') {
      return { ok: false, code: 'SELF_LOCK', message: '不能取消自己的 HR 资格，请请另一位 HR 帮忙操作' }
    }
    if (update.active === false) {
      return { ok: false, code: 'SELF_LOCK', message: '不能停用自己' }
    }
  }

  try {
    await db.collection('employees').doc(targetId).update({ data: update })
    const re = await db.collection('employees').doc(targetId).get()
    const e = re.data || {}
    return {
      ok: true,
      updated: {
        _id: e._id,
        name: e.name || '',
        dept: e.dept || '',
        role: e.role || 'employee',
        active: e.active !== false
      }
    }
  } catch (err) {
    console.error('[hrSetEmployee] DB error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
