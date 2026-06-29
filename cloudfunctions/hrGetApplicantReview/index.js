// cloudfunctions/hrGetApplicantReview/index.js
//
// 用途：HR 复盘某位员工某场考试的完整答卷。
//
// 入参：{ enrollmentId: string }
//
// 返回：
//   { ok: true,
//     assessment: { _id, name, isMock },
//     employee:   { openid, name, dept, role },
//     enrollment: { _id, status, score, fullScore, rightNum, total,
//                   submittedAt, startedAt, switchCount, scoreDetail,
//                   questionConfig, isMock },
//     questions:       [...],     // 题目快照（含 options/typecode/typename/comments）
//     answersOfficial: [...],     // [{ qid, correctCodes:[...] }]
//     userAnswers:     { qid: [codes] }
//   }
//   { ok: false, code, message }
//
// 错误码：NO_OPENID / FORBIDDEN / MISSING_ID /
//        ENROLLMENT_NOT_FOUND / NOT_SUBMITTED / DB_ERROR
//
// 设计要点：
//   - HR / admin 才能调用；普通员工调用直接 FORBIDDEN
//   - 只允许复盘 status === 'submitted' 的 enrollment（答题中或缺考的没意义）
//   - 不做"是否本部门"过滤：HR 默认可见全员，admin 显然也可。
//     后续若需"HR 只看自部门"，在此处加 dept 白名单即可
//   - employee 反查失败（被删除/openid 变更）不阻断：返回兜底 {name:'(已离职)'}
//   - assessment 反查失败：返回兜底 {name:'(考试已删除)'}，主流程不阻断

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

  const enrollmentId = event && event.enrollmentId
  if (!enrollmentId) {
    return { ok: false, code: 'MISSING_ID', message: '缺少 enrollmentId' }
  }

  try {
    // ── 1) 取 enrollment 本体
    const eRes = await db.collection('examEnrollments').doc(enrollmentId).get().catch(() => null)
    if (!eRes || !eRes.data) {
      return { ok: false, code: 'ENROLLMENT_NOT_FOUND', message: '答卷不存在' }
    }
    const e = eRes.data
    if (e.status !== 'submitted') {
      return { ok: false, code: 'NOT_SUBMITTED', message: '该员工尚未交卷，暂无法复盘' }
    }

    // ── 2) 反查 employee（容错）
    let employee = { openid: e.openid || '', name: '(未知员工)', dept: '', role: 'employee' }
    if (e.openid) {
      const empRes = await db.collection('employees').where({ openid: e.openid }).limit(1).get().catch(() => null)
      if (empRes && empRes.data && empRes.data[0]) {
        const emp = empRes.data[0]
        employee = {
          openid: emp.openid || e.openid,
          name: emp.name || '(未填姓名)',
          dept: emp.dept || '',
          role: emp.role || 'employee'
        }
      } else {
        employee.name = '(已离职/已删除)'
      }
    }

    // ── 3) 反查 assessment（容错）
    let assessment = { _id: e.assessmentId || '', name: '(考试已删除)', isMock: !!e.isMock }
    if (e.assessmentId) {
      const aRes = await db.collection('assessments').doc(e.assessmentId).get().catch(() => null)
      if (aRes && aRes.data) {
        assessment = {
          _id: aRes.data._id,
          name: aRes.data.name || '(未命名考试)',
          isMock: !!e.isMock
        }
      }
    }

    // ── 4) 组装返回
    return {
      ok: true,
      assessment,
      employee,
      enrollment: {
        _id: e._id,
        status: e.status,
        score: typeof e.score === 'number' ? e.score : 0,
        fullScore: typeof e.fullScore === 'number' ? e.fullScore : 0,
        rightNum: typeof e.rightNum === 'number' ? e.rightNum : 0,
        total: typeof e.total === 'number' ? e.total : (Array.isArray(e.questions) ? e.questions.length : 0),
        submittedAt: e.submittedAt || null,
        startedAt: e.startedAt || null,
        switchCount: typeof e.switchCount === 'number' ? e.switchCount : 0,
        scoreDetail: Array.isArray(e.scoreDetail) ? e.scoreDetail : [],
        questionConfig: e.questionConfig || null,
        isMock: !!e.isMock
      },
      questions: Array.isArray(e.questions) ? e.questions : [],
      answersOfficial: Array.isArray(e.answersOfficial) ? e.answersOfficial : [],
      userAnswers: (e.answers && typeof e.answers === 'object') ? e.answers : {}
    }
  } catch (err) {
    console.error('[hrGetApplicantReview] DB error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
