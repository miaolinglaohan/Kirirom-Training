// cloudfunctions/hrSetEmployee/index.js
//
// 用途：HR 新建 / 修改员工。
//
// 新建模式（_id 为空）：
//   { name, dept, role, active, openid }
//   必填：name / dept / openid
//
// 编辑模式（_id 非空）：
//   { _id, patch: { role?, active?, dept?, openid? } }
//
// 返回：
//   { ok: true, updated: {...} }    编辑成功
//   { ok: true, created: {...} }    新建成功
//   { ok: false, code, message }
//
// 安全约束：
//   - 调用者必须是 HR 或 admin
//   - 不允许调用者把自己的 role 改成 employee / active 改成 false
//   - role 只接受 'hr' 或 'employee'；admin 角色不通过本函数设置
//   - openid 不允许重复绑定到多个员工

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function requireHr(OPENID) {
  if (!OPENID) return { err: { ok: false, code: 'NO_OPENID', message: '无法获取微信身份' } }
  const r = await db.collection('employees').where({ openid: OPENID }).limit(1).get()
  const me = r.data[0]
  if (!me || me.active === false || (me.role !== 'hr' && me.role !== 'admin')) {
    return { err: { ok: false, code: 'FORBIDDEN', message: '没有 HR 权限' } }
  }
  return { me }
}

// openid 去重校验：检查给定 openid 是否已被其他员工绑定
async function checkOpenidDup(openid, excludeId) {
  if (!openid) return null
  const where = { openid }
  if (excludeId) where._id = _.neq(excludeId)
  const r = await db.collection('employees').where(where).limit(1).get()
  return (r.data && r.data.length > 0) ? r.data[0] : null
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const g = await requireHr(OPENID)
  if (g.err) return g.err
  const me = g.me

  const targetId = String(event._id || '').trim()

  // ── 新建模式 ──
  if (!targetId) {
    const name = String(event.name || '').trim()
    const dept = String(event.dept || '').trim()
    const role = String(event.role || '').trim()
    const active = event.active !== false
    const openid = String(event.openid || '').trim()

    if (!name) return { ok: false, code: 'MISSING_NAME', message: '请填写姓名' }
    if (!dept) return { ok: false, code: 'MISSING_DEPT', message: '请选择部门' }
    // openid 可选：留空时后续通过编辑绑定
    if (openid) {
      // openid 去重
      const dup = await checkOpenidDup(openid)
      if (dup) {
        return { ok: false, code: 'DUPLICATE_OPENID', message: `该用户码已被「${dup.name}」绑定` }
      }
    }

    if (role && role !== 'hr' && role !== 'employee') {
      return { ok: false, code: 'INVALID_ROLE', message: 'role 只允许 hr / employee' }
    }

    try {
      const doc = {
        name,
        dept,
        role: role || 'employee',
        active,
        activatedAt: new Date()
      }
      if (openid) doc.openid = openid
      const addRes = await db.collection('employees').add({ data: doc })
      return {
        ok: true,
        created: {
          _id: addRes._id,
          name,
          dept,
          role: role || 'employee',
          active
        }
      }
    } catch (err) {
      console.error('[hrSetEmployee] create error', err)
      return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
    }
  }

  // ── 编辑模式 ──
  const patch = event.patch || {}
  if (Object.keys(patch).length === 0) {
    return { ok: false, code: 'EMPTY_PATCH', message: '没有要更新的字段' }
  }

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
  if (Object.prototype.hasOwnProperty.call(patch, 'openid')) {
    update.openid = String(patch.openid || '').trim()
  }
  if (Object.keys(update).length === 0) {
    return { ok: false, code: 'EMPTY_PATCH', message: '没有有效的更新字段' }
  }

  // openid 去重
  if (update.openid) {
    const dup = await checkOpenidDup(update.openid, targetId)
    if (dup) {
      return { ok: false, code: 'DUPLICATE_OPENID', message: `该用户码已被「${dup.name}」绑定` }
    }
  }

  // 防自锁
  if (String(targetId) === String(me._id)) {
    if (update.role === 'employee') {
      return { ok: false, code: 'SELF_LOCK', message: '不能取消自己的管理权限，请请另一位管理员帮忙操作' }
    }
    if (update.active === false) {
      return { ok: false, code: 'SELF_LOCK', message: '不能停用自己' }
    }
  }

  // 保护 admin 超管
  try {
    const tr = await db.collection('employees').doc(targetId).get()
    const target = tr.data
    if (!target) return { ok: false, code: 'NOT_FOUND', message: '员工不存在' }
    if (target.role === 'admin') {
      return { ok: false, code: 'PROTECTED', message: '超管账号请在云开发控制台直接修改' }
    }
  } catch (err) {
    return { ok: false, code: 'NOT_FOUND', message: '员工不存在' }
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
        active: e.active !== false,
        openid: e.openid || ''
      }
    }
  } catch (err) {
    console.error('[hrSetEmployee] DB error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
