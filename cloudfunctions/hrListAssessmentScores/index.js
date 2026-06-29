// cloudfunctions/hrListAssessmentScores/index.js
//
// 用途：HR 查看某场考试的成绩单。
//   ① 拉考试本体（含 questionConfig，派生 totalQuestions / fullScore）
//   ② 拉应到名单：employees 表中 active!=false 的员工，按 assessment.targetDepts 过滤
//      （targetDepts 为空数组表示"全部部门"，与 enterExam 的 NOT_IN_SCOPE 校验保持同义）
//   ③ 拉 examEnrollments：assessmentId=X 且 isMock!=true 的所有报名
//   ④ Left join：每位员工 → 一条成绩记录，三态 absent / in_progress / submitted
//   ⑤ Summary 派生：应到 / 已交卷 / 进行中 / 缺考 / 平均分（仅 submitted 参与）
//
// 入参：{ assessmentId: string }
// 返回：
//   { ok: true,
//     assessment: { _id, name, startTime, duration, targetDepts, questionConfig,
//                   totalQuestions, fullScore, ...其它原字段 },
//     summary: { expected, submitted, inProgress, absent, avgScore },
//     applicants: [{
//       openid, employeeId, name, dept, role,
//       status: 'absent'|'in_progress'|'submitted',
//       enrollmentId, score, fullScore, rightNum, total, submittedAt, startedAt, switchCount
//     }]
//   }
//   { ok: false, code, message }
//
// 错误码：NO_OPENID / FORBIDDEN / MISSING_ASSESSMENT / ASSESSMENT_NOT_FOUND / DB_ERROR

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

// 与 hrListAssessments 一致的派生逻辑（保持口径统一）
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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const g = await requireHr(OPENID)
  if (g.err) return g.err

  const assessmentId = event && event.assessmentId
  if (!assessmentId) {
    return { ok: false, code: 'MISSING_ASSESSMENT', message: '缺少 assessmentId' }
  }

  try {
    // ── 1) 取考试本体
    const aRes = await db.collection('assessments').doc(assessmentId).get().catch(() => null)
    if (!aRes || !aRes.data) {
      return { ok: false, code: 'ASSESSMENT_NOT_FOUND', message: '考试不存在' }
    }
    const a = aRes.data
    const { totalQuestions, fullScore } = deriveCounts(a)
    const targetDepts = Array.isArray(a.targetDepts) ? a.targetDepts : []

    // ── 2) 拉应到员工名单
    //   - active != false（停用员工不算缺考）
    //   - targetDepts 非空时按部门白名单过滤；为空表示"全部部门"
    //   - 不按 role 过滤：HR/admin 同样可被指派参加考试
    const empWhere = { active: _.neq(false) }
    if (targetDepts.length > 0) {
      empWhere.dept = _.in(targetDepts)
    }
    const empRes = await db.collection('employees')
      .where(empWhere)
      .limit(1000)
      .get()
    const employees = empRes.data || []

    // ── 3) 拉 examEnrollments（排除模考）
    const eRes = await db.collection('examEnrollments')
      .where({
        assessmentId,
        isMock: _.neq(true)
      })
      .limit(1000)
      .get()
    const enrollments = eRes.data || []

    // 按 openid 索引（一个员工一场考试理论上只有一条 enrollment，_id 主键保证）
    const enrollByOpenid = {}
    enrollments.forEach(e => {
      if (e.openid) enrollByOpenid[e.openid] = e
    })

    // ── 4) Left join 员工 ← enrollment
    let inProgressCount = 0
    let submittedCount = 0
    let absentCount = 0
    let scoreSum = 0
    let scoreSamples = 0

    const applicants = employees.map(emp => {
      const e = enrollByOpenid[emp.openid]
      const base = {
        openid: emp.openid || '',
        employeeId: emp._id,
        name: emp.name || '',
        dept: emp.dept || '',
        role: emp.role || 'employee'
      }
      if (!e) {
        absentCount++
        return {
          ...base,
          status: 'absent',
          enrollmentId: null,
          score: null,
          fullScore,
          rightNum: null,
          total: null,
          submittedAt: null,
          startedAt: null,
          switchCount: null
        }
      }
      if (e.status === 'submitted') {
        submittedCount++
        const s = typeof e.score === 'number' ? e.score : 0
        scoreSum += s
        scoreSamples++
      } else {
        inProgressCount++
      }
      return {
        ...base,
        status: e.status === 'submitted' ? 'submitted' : 'in_progress',
        enrollmentId: e._id,
        score: typeof e.score === 'number' ? e.score : null,
        fullScore: typeof e.fullScore === 'number' ? e.fullScore : fullScore,
        rightNum: typeof e.rightNum === 'number' ? e.rightNum : null,
        total: typeof e.total === 'number' ? e.total : null,
        submittedAt: e.submittedAt || null,
        startedAt: e.startedAt || null,
        switchCount: typeof e.switchCount === 'number' ? e.switchCount : 0
      }
    })

    // 排序：submitted 在前（按分数倒序），其次 in_progress（按 startedAt 倒序），最后 absent（按姓名）
    const statusOrder = { submitted: 0, in_progress: 1, absent: 2 }
    applicants.sort((x, y) => {
      const so = statusOrder[x.status] - statusOrder[y.status]
      if (so !== 0) return so
      if (x.status === 'submitted') {
        const sx = x.score == null ? -1 : x.score
        const sy = y.score == null ? -1 : y.score
        return sy - sx
      }
      if (x.status === 'in_progress') {
        const tx = x.startedAt ? new Date(x.startedAt).getTime() : 0
        const ty = y.startedAt ? new Date(y.startedAt).getTime() : 0
        return ty - tx
      }
      return (x.name || '').localeCompare(y.name || '')
    })

    // ── 5) Summary
    const summary = {
      expected: employees.length,
      submitted: submittedCount,
      inProgress: inProgressCount,
      absent: absentCount,
      avgScore: scoreSamples > 0 ? Math.round((scoreSum / scoreSamples) * 10) / 10 : null
    }

    return {
      ok: true,
      assessment: {
        ...a,
        totalQuestions,
        fullScore
      },
      summary,
      applicants
    }
  } catch (err) {
    console.error('[hrListAssessmentScores] DB error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
