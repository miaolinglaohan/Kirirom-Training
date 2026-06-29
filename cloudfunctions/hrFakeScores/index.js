// cloudfunctions/hrFakeScores/index.js
//
// ⚠️ DEV ONLY ⚠️
// 仅在 v0.3.3 自测期间使用，用于给某场考试 seed / clean 假数据，
// 让成绩中心页能看到 submitted / in_progress / absent 三种状态混合渲染。
// 正式上线前请删除本云函数。
//
// 入参：
//   { action: 'seed', assessmentId }     —— 插入 5 个假员工 + 3 条假 enrollment
//   { action: 'clean', assessmentId }    —— 清掉本函数产生的所有假数据
//
// 假数据约定：
//   - employees._id 以 `fake_emp_` 开头
//   - employees.openid 以 `fake_openid_` 开头
//   - examEnrollments._id 形如 `${assessmentId}_fake_openid_xxx`
//   所有 clean 操作严格按这三个前缀做，绝不碰真实数据。
//
// 5 个假员工的状态分布：
//   1. 测试员A · 已交卷 · 85/100
//   2. 测试员B · 已交卷 · 62/100
//   3. 测试员C · 答题中（开始 5 分钟前）· 切屏 2 次
//   4. 测试员D · 缺考（无 enrollment）
//   5. 测试员E · 缺考（无 enrollment）

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function requireHr(OPENID) {
  // 控制台「云端测试」直调云函数时 OPENID 为空。
  // 本函数是 dev-only seed/clean 工具，云函数控制台只有项目所有者能进，
  // 因此允许"无 OPENID 即视为控制台调用"豁免，方便测试。
  // 正常小程序路径 OPENID 必然存在，仍走 HR 守卫。
  if (!OPENID) {
    console.warn('[hrFakeScores] NO_OPENID — assuming cloud console test, bypassing HR guard')
    return { me: { name: 'cloud-console', role: 'admin', _bypass: true } }
  }
  const r = await db.collection('employees').where({ openid: OPENID }).limit(1).get()
  const me = r.data[0]
  if (!me || me.active === false || (me.role !== 'hr' && me.role !== 'admin')) {
    return { err: { ok: false, code: 'FORBIDDEN', message: '没有 HR 权限' } }
  }
  return { me }
}

// 5 个假员工模板：name / 部门 / 状态 / 分数
const FAKE_EMPLOYEES = [
  { suffix: 'A', name: '测试员A', score: 85, status: 'submitted', switchCount: 0, minutesAgo: 30 },
  { suffix: 'B', name: '测试员B', score: 62, status: 'submitted', switchCount: 0, minutesAgo: 25 },
  { suffix: 'C', name: '测试员C', score: null, status: 'in_progress', switchCount: 2, minutesAgo: 5 },
  { suffix: 'D', name: '测试员D', score: null, status: 'absent', switchCount: 0, minutesAgo: 0 },
  { suffix: 'E', name: '测试员E', score: null, status: 'absent', switchCount: 0, minutesAgo: 0 }
]

async function doSeed(assessmentId) {
  // 取考试目标部门：用第一个 targetDept 作为假员工部门，没指定则用 "测试部门"
  const aRes = await db.collection('assessments').doc(assessmentId).get().catch(() => null)
  if (!aRes || !aRes.data) {
    return { ok: false, code: 'ASSESSMENT_NOT_FOUND', message: '考试不存在' }
  }
  const a = aRes.data
  const dept = (Array.isArray(a.targetDepts) && a.targetDepts.length > 0)
    ? a.targetDepts[0]
    : '测试部门'

  // 派生 fullScore（与 hrListAssessmentScores 口径一致）
  const c = a.questionConfig
  let fullScore = 0
  let total = 0
  if (c) {
    const counts = ['single', 'multi', 'judge'].map(k => Number(c[k] && c[k].count) || 0)
    const scores = ['single', 'multi', 'judge'].map(k => Number(c[k] && c[k].score) || 0)
    fullScore = counts.reduce((acc, n, i) => acc + n * scores[i], 0)
    total = counts.reduce((acc, n) => acc + n, 0)
  } else {
    fullScore = Number(a.questionCount) || 0
    total = fullScore
  }

  const insertedEmployees = []
  const insertedEnrollments = []

  for (const e of FAKE_EMPLOYEES) {
    const empId = `fake_emp_${e.suffix}`
    const openid = `fake_openid_${e.suffix}`

    // 1) 写假员工（用 set 而非 add：重复 seed 可幂等）
    await db.collection('employees').doc(empId).set({
      data: {
        name: e.name,
        dept,
        role: 'employee',
        active: true,
        openid,
        activatedAt: new Date(),
        _isFake: true   // 标记，clean 时可二次校验
      }
    })
    insertedEmployees.push(empId)

    // 2) 写假 enrollment（absent 不写）
    if (e.status === 'absent') continue

    const enrollId = `${assessmentId}_${openid}`
    const startedAt = new Date(Date.now() - e.minutesAgo * 60 * 1000)
    const enrollDoc = {
      assessmentId,
      isMock: false,
      openid,
      employeeId: empId,
      status: e.status,
      questions: [],          // 空快照足够成绩页用
      answersOfficial: [],
      answers: {},
      score: e.score,
      fullScore,
      total,
      rightNum: e.status === 'submitted' && fullScore > 0
        ? Math.round((e.score / fullScore) * total)
        : null,
      startedAt,
      submittedAt: e.status === 'submitted' ? new Date() : null,
      deadline: new Date(Date.now() + 30 * 60 * 1000),
      switchCount: e.switchCount,
      clientLastSavedAt: startedAt,
      _isFake: true
    }
    // set 而非 add：幂等
    await db.collection('examEnrollments').doc(enrollId).set({ data: enrollDoc })
    insertedEnrollments.push(enrollId)
  }

  return {
    ok: true,
    action: 'seed',
    assessmentId,
    dept,
    fullScore,
    total,
    insertedEmployees,
    insertedEnrollments
  }
}

async function doClean(assessmentId) {
  let removedEnrollments = 0
  let removedEmployees = 0

  // 1) 删 enrollments：本场考试 + 含 _isFake 标记
  //    （或者 _id 以 `${assessmentId}_fake_openid_` 开头）
  for (const e of FAKE_EMPLOYEES) {
    if (e.status === 'absent') continue
    const enrollId = `${assessmentId}_fake_openid_${e.suffix}`
    try {
      await db.collection('examEnrollments').doc(enrollId).remove()
      removedEnrollments++
    } catch (err) { /* 不存在就跳 */ }
  }

  // 2) 删假员工（这些是全局共用的，不绑定特定 assessment；
  //    若你想留住假员工跨场复用，把下面这段注释掉即可）
  for (const e of FAKE_EMPLOYEES) {
    const empId = `fake_emp_${e.suffix}`
    try {
      // 双重校验：必须带 _isFake 标记才删
      const r = await db.collection('employees').doc(empId).get().catch(() => null)
      if (r && r.data && r.data._isFake === true) {
        await db.collection('employees').doc(empId).remove()
        removedEmployees++
      }
    } catch (err) { /* skip */ }
  }

  return {
    ok: true,
    action: 'clean',
    assessmentId,
    removedEnrollments,
    removedEmployees
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const g = await requireHr(OPENID)
  if (g.err) return g.err

  const action = event && event.action
  const assessmentId = event && event.assessmentId
  if (!assessmentId) {
    return { ok: false, code: 'MISSING_ASSESSMENT', message: '缺少 assessmentId' }
  }

  try {
    if (action === 'seed') return await doSeed(assessmentId)
    if (action === 'clean') return await doClean(assessmentId)
    return { ok: false, code: 'BAD_ACTION', message: 'action 必须是 seed 或 clean' }
  } catch (err) {
    console.error('[hrFakeScores] error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
