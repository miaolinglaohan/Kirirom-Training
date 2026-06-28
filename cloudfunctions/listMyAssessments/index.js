// cloudfunctions/listMyAssessments/index.js
//
// 用途：列出当前员工"可见的"摸底考试。
//
// 为什么需要这个云函数：
//   小程序端直接 db.collection('assessments').get() 会被微信自动加 _openid 过滤，
//   而 HR 在控制台/Web 后台创建的考试没有 _openid 字段 → 员工查不到。
//   云函数以服务端身份访问数据库，绕过 _openid 过滤，并能服务端做 dept 范围过滤。
//
// 入参：
//   { onlyActive?: boolean }   // true=只返回未截止的；默认 false（也返回历史）
//
// 返回：
//   { ok: true, now, list: [ { ...assessment, status, statusText, deadline } ] }
//   { ok: false, code, message }

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, code: 'NO_OPENID', message: '无法获取微信身份' }

  const onlyActive = !!event.onlyActive

  try {
    // 取员工部门（用于 targetDepts 过滤）
    const empRes = await db.collection('employees')
      .where({ openid: OPENID }).limit(1).get()
    if (empRes.data.length === 0) {
      return { ok: false, code: 'UNACTIVATED', message: '请先完成员工激活' }
    }
    const dept = (empRes.data[0] || {}).dept || ''

    // 用云函数身份取所有 visible 的考试（绕过 _openid 默认过滤）
    const asRes = await db.collection('assessments')
      .where({ visible: true })
      .orderBy('startTime', 'asc')
      .limit(200)
      .get()

    const now = Date.now()
    const all = asRes.data || []

    // 部门过滤 + 状态计算
    const list = []
    for (const a of all) {
      const targetDepts = Array.isArray(a.targetDepts) ? a.targetDepts : []
      const inScope = targetDepts.length === 0 || targetDepts.indexOf(dept) >= 0
      if (!inScope) continue

      const start = new Date(a.startTime || 0).getTime()
      const duration = (a.duration || 0) * 60 * 1000
      const end = start + duration
      let status
      if (now < start) status = 'pending'
      else if (now <= end) status = 'ongoing'
      else status = 'expired'

      if (onlyActive && status === 'expired') continue

      list.push({
        ...a,
        startMs: start,
        endMs: end,
        deadline: end,
        status
      })
    }

    return { ok: true, now, list }
  } catch (err) {
    console.error('[listMyAssessments] error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
