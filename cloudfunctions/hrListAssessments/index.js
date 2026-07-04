// cloudfunctions/hrListAssessments/index.js
//
// 用途：HR 全量考试列表。和员工版 listMyAssessments 不同点：
//   1) 不按 targetDepts 过滤（HR 看全部）
//   2) 包含 visible=false 的草稿
//   3) 包含 expired 的历史
//   4) 每场拉出 enrolled / submitted 两个人数统计
//
// 入参：{} （未来可加 onlyVisible / search）
// 返回：
//   { ok: true, now, list: [ { ...assessment, status, totalQuestions, fullScore, enrolled, submitted } ] }

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

// 派生题量 + 满分（与 listMyAssessments 同步）
function deriveCounts(a) {
  const c = a.questionConfig
  if (c) {
    const s = (c.single && Number(c.single.count)) || 0
    const m = (c.multi  && Number(c.multi.count))  || 0
    const j = (c.judge  && Number(c.judge.count))  || 0
    const ss = (c.single && Number(c.single.score)) || 0
    const ms = (c.multi  && Number(c.multi.score))  || 0
    const js = (c.judge  && Number(c.judge.score))  || 0
    return { totalQuestions: s + m + j, fullScore: s * ss + m * ms + j * js }
  }
  const n = Number(a.questionCount) || 0
  return { totalQuestions: n, fullScore: n }
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const g = await requireHr(OPENID)
  if (g.err) return g.err

  try {
    const asRes = await db.collection('assessments')
      .orderBy('startTime', 'desc')
      .limit(500)
      .get()
    const all = asRes.data || []

    // 一次性把所有 enrollment 拉回来，本地分组（500 场 × 平均几十人，量级可控）
    // 如果未来量级大可改为 per-id $group
    const ids = all.map(a => a._id)
    let enrollmentsByAssessment = {}
    if (ids.length > 0) {
      const eRes = await db.collection('examEnrollments')
        .where({ assessmentId: _.in(ids) })
        .field({ assessmentId: true, status: true, isMock: true })
        .limit(5000)
        .get()
      ;(eRes.data || []).forEach(e => {
        if (e.isMock) return
        const k = e.assessmentId
        if (!enrollmentsByAssessment[k]) enrollmentsByAssessment[k] = { enrolled: 0, submitted: 0 }
        enrollmentsByAssessment[k].enrolled++
        if (e.status === 'submitted') enrollmentsByAssessment[k].submitted++
      })
    }

    const now = Date.now()
    const list = all.map(a => {
      const start = new Date(a.startTime || 0).getTime()
      const duration = (a.duration || 0) * 60 * 1000
      // 有效期：有 validHours 用 validUntil；旧考试无该字段回退到 start+duration（统一截止）
      const validHours = Number(a.validHours) || 0
      let validUntil = validHours > 0
        ? start + validHours * 60 * 60 * 1000
        : start + duration
      // HR 提前结束：endedAt 截断 validUntil
      if (a.endedAt) {
        const endedMs = new Date(a.endedAt).getTime()
        if (Number.isFinite(endedMs) && endedMs < validUntil) validUntil = endedMs
      }
      let status
      if (a.visible === false) status = 'hidden'
      else if (now < start) status = 'pending'
      else if (now <= validUntil) status = 'ongoing'
      else status = 'expired'
      const counts = enrollmentsByAssessment[a._id] || { enrolled: 0, submitted: 0 }
      const { totalQuestions, fullScore } = deriveCounts(a)
      return {
        ...a,
        startMs: start,
        endMs: validUntil,
        validUntilMs: validUntil,
        validHours: validHours || 0,
        deadline: validUntil,
        status,
        totalQuestions,
        fullScore,
        enrolled: counts.enrolled,
        submitted: counts.submitted
      }
    })

    return { ok: true, now, list }
  } catch (err) {
    console.error('[hrListAssessments] DB error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
