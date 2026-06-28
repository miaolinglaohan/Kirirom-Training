// cloudfunctions/activate/index.js
//
// 用途：员工首次激活。根据「姓名 + 部门」匹配白名单，将当前 openid 绑定到对应记录。
//
// 入参：{ name: string, dept: string }
// 返回：
//   { ok: true,  employee: {...} }                          激活成功
//   { ok: false, code: 'MISSING_FIELDS',    message: ... }  姓名或部门为空
//   { ok: false, code: 'INVALID_DEPT',      message: ... }  部门不在枚举内
//   { ok: false, code: 'ALREADY_ACTIVATED', message: ... }  该微信已激活过
//   { ok: false, code: 'NOT_FOUND',         message: ... }  白名单没有匹配
//   { ok: false, code: 'AMBIGUOUS',         message: ... }  同名同部门多人，需 HR 处理
//   { ok: false, code: 'DISABLED',          message: ... }  匹配到但 active=false
//   { ok: false, code: 'NO_OPENID',         message: ... }  系统级错误

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// 部门白名单，必须和 docs/数据库设计.md 保持一致
const VALID_DEPTS = [
  '项目部',
  '运行检修部',
  '综合管理部',
  '枢纽管理部',
  '安全技术部',
  '财务资金部'
]

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '无法获取微信身份' }
  }

  let { name, dept } = event || {}
  name = (name || '').trim()
  dept = (dept || '').trim()

  if (!name || !dept) {
    return { ok: false, code: 'MISSING_FIELDS', message: '请填写姓名和部门' }
  }
  if (!VALID_DEPTS.includes(dept)) {
    return { ok: false, code: 'INVALID_DEPT', message: '部门无效，请重新选择' }
  }

  try {
    // 1) 当前微信号是否已经绑过 —— 不允许重复激活
    const already = await db.collection('employees')
      .where({ openid: OPENID })
      .limit(1)
      .get()

    if (already.data.length > 0) {
      const emp = already.data[0]
      return {
        ok: false,
        code: 'ALREADY_ACTIVATED',
        message: '该微信已激活，无需重复绑定',
        employee: {
          _id: emp._id, name: emp.name, dept: emp.dept,
          role: emp.role, active: emp.active
        }
      }
    }

    // 2) 按姓名 + 部门查未激活的记录（openid 为空字符串）
    const match = await db.collection('employees')
      .where({ name, dept, openid: '' })
      .limit(2)
      .get()

    if (match.data.length === 0) {
      // 也许匹配到但已停用？查一下给个更友好的提示
      const disabled = await db.collection('employees')
        .where({ name, dept, active: false })
        .limit(1)
        .get()
      if (disabled.data.length > 0) {
        return { ok: false, code: 'DISABLED', message: '该员工账号已停用，请联系 HR' }
      }
      return { ok: false, code: 'NOT_FOUND', message: '未找到匹配的员工记录，请联系 HR 核对姓名与部门' }
    }

    if (match.data.length > 1) {
      return { ok: false, code: 'AMBIGUOUS', message: '同名同部门员工存在多人，请联系 HR 处理' }
    }

    const emp = match.data[0]
    if (emp.active === false) {
      return { ok: false, code: 'DISABLED', message: '该员工账号已停用，请联系 HR' }
    }

    // 3) 绑定 openid 并写入激活时间
    const activatedAt = new Date()
    await db.collection('employees').doc(emp._id).update({
      data: {
        openid: OPENID,
        activatedAt
      }
    })

    return {
      ok: true,
      employee: {
        _id: emp._id,
        name: emp.name,
        dept: emp.dept,
        role: emp.role,
        active: emp.active,
        activatedAt
      }
    }
  } catch (err) {
    console.error('[activate] DB error:', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
