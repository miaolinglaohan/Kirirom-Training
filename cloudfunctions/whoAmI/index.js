// cloudfunctions/whoAmI/index.js
//
// 用途：根据当前微信用户的 openid 查询员工白名单，返回身份状态。
//      App 启动时 / 我的页刷新时调用，决定是否跳激活页、是否显示管理后台入口。
//
// 入参：无（云函数从 wxContext 自动拿 OPENID）
// 返回：
//   { status: 'active',       employee: {...} }   已激活且启用
//   { status: 'unactivated'                    }   该 openid 不在白名单
//   { status: 'disabled',     employee: {...} }   已激活但被 HR 停用
//   { status: 'error',        message: '...'   }   异常
//
// 注意：返回 employee 对象时**故意不带 openid**，前端不需要也降低暴露面。

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  if (!OPENID) {
    return { status: 'error', message: '无法获取微信身份（OPENID 缺失）' }
  }

  try {
    const res = await db.collection('employees')
      .where({ openid: OPENID })
      .limit(1)
      .get()

    if (res.data.length === 0) {
      return { status: 'unactivated', openid: OPENID }
    }

    const emp = res.data[0]
    const safe = {
      _id: emp._id,
      name: emp.name,
      dept: emp.dept,
      role: emp.role,
      activatedAt: emp.activatedAt,
      active: emp.active
    }

    if (emp.active === false) {
      return { status: 'disabled', openid: OPENID, employee: safe }
    }

    return { status: 'active', openid: OPENID, employee: safe }
  } catch (err) {
    console.error('[whoAmI] DB error:', err)
    return { status: 'error', message: err.errMsg || String(err) }
  }
}
