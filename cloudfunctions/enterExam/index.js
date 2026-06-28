// cloudfunctions/enterExam/index.js
//
// 用途：员工进入考场。两种模式：
//   1) 正式考试 (isMock=false): 必须传 assessmentId，云函数从 assessments 集合读规则
//   2) 模拟考试 (isMock=true): 传 subjectId + 可选 questionCount + 可选 duration
//
// 核心职责：
//   ① 校验：员工已激活、考试可见、未停用、未过时、部门在 targetDepts 范围内
//   ② 防重入：用 _id = "{assessmentId}_{openid}" 防止同一人重复创建多卷
//   ③ 抽题：从 questions 集合按 subjectId 随机抽 N 题
//   ④ 剥离答案：写入 enrollment 前移除 options[].value，另存 answersOfficial
//   ⑤ 固化 deadline：正式考 = assessment.startTime + duration（全员同一截止）
//                      模考    = now + duration（每场独立计时）
//
// 入参：
//   { assessmentId: string } 正式
//   { isMock: true, subjectId: string, questionCount?: number, duration?: number } 模考
//
// 返回：
//   { ok: true, enrollmentId, questions, deadline, total, durationMs, startedAt, isMock }
//   { ok: false, code, message }

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const DEFAULT_MOCK_QUESTION_COUNT = 10
const DEFAULT_MOCK_DURATION_MIN = 15

// 从原始题目剥离答案：返回 [strippedQuestion, officialAnswer]
function stripAnswer(q) {
  const correctCodes = []
  const options = (q.options || []).map(opt => {
    if (String(opt.value) === '1') correctCodes.push(opt.code)
    return { code: opt.code, content: opt.content }   // 丢掉 value
  })
  const stripped = {
    _id: q._id,
    title: q.title,
    typecode: q.typecode,
    typename: q.typename,
    comments: q.comments,           // 注意：comments 也含解析，正式考时可考虑剥离；MVP 保留
    options,
    examid: q.examid
  }
  return [stripped, { qid: q._id, correctCodes }]
}

// 在数组里 Fisher-Yates 洗牌，取前 N 项
function pickRandom(arr, n) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, Math.min(n, a.length))
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, code: 'NO_OPENID', message: '无法获取微信身份' }

  const isMock = !!event.isMock

  try {
    // ── 0) 取当前员工
    const empRes = await db.collection('employees')
      .where({ openid: OPENID }).limit(1).get()
    if (empRes.data.length === 0) {
      return { ok: false, code: 'UNACTIVATED', message: '请先完成员工激活' }
    }
    const emp = empRes.data[0]
    if (emp.active === false) {
      return { ok: false, code: 'DISABLED', message: '账号已停用' }
    }

    // ── 1) 解析考试规则（subjectId / duration / questionCount / startTime / enrollmentId）
    let subjectId, durationMin, questionCount, startedAt, deadline, enrollmentId, assessmentId

    const now = Date.now()

    if (isMock) {
      subjectId = String(event.subjectId || '').trim()
      if (!subjectId) return { ok: false, code: 'MISSING_SUBJECT', message: '模考缺少题库参数' }
      durationMin = Number(event.duration) > 0 ? Number(event.duration) : DEFAULT_MOCK_DURATION_MIN
      questionCount = Number(event.questionCount) > 0 ? Number(event.questionCount) : DEFAULT_MOCK_QUESTION_COUNT
      startedAt = new Date(now)
      deadline = new Date(now + durationMin * 60 * 1000)
      // 模考 enrollmentId 每次都新建（允许员工多次模考）
      enrollmentId = 'mock_' + now + '_' + OPENID
      assessmentId = ''
    } else {
      assessmentId = String(event.assessmentId || '').trim()
      if (!assessmentId) return { ok: false, code: 'MISSING_ASSESSMENT', message: '缺少考试 ID' }

      const asRes = await db.collection('assessments').doc(assessmentId).get().catch(() => null)
      if (!asRes || !asRes.data) {
        return { ok: false, code: 'ASSESSMENT_NOT_FOUND', message: '考试不存在或已撤销' }
      }
      const a = asRes.data
      if (a.visible === false) {
        return { ok: false, code: 'NOT_VISIBLE', message: '考试未发布' }
      }

      const startMs = new Date(a.startTime).getTime()
      const endMs = startMs + (a.duration || 0) * 60 * 1000

      if (now < startMs) return { ok: false, code: 'NOT_STARTED', message: '考试尚未开始' }
      if (now > endMs) return { ok: false, code: 'EXPIRED', message: '考试已截止' }

      const targetDepts = Array.isArray(a.targetDepts) ? a.targetDepts : []
      if (targetDepts.length > 0 && targetDepts.indexOf(emp.dept) < 0) {
        return { ok: false, code: 'NOT_IN_SCOPE', message: '您不在本场考试目标部门内' }
      }

      subjectId = a.subjectId
      durationMin = a.duration
      questionCount = a.questionCount
      startedAt = new Date(now)
      // 正式考统一截止：全员从 assessment.startTime 算起，进场晚=时间少
      deadline = new Date(endMs)
      enrollmentId = assessmentId + '_' + OPENID
    }

    // ── 2) 防重入：检查 enrollment 是否已存在
    const exist = await db.collection('examEnrollments').doc(enrollmentId).get().catch(() => null)
    if (exist && exist.data) {
      const r = exist.data
      if (r.status === 'submitted') {
        return { ok: false, code: 'ALREADY_SUBMITTED', message: '您已提交此次考试' }
      }
      if (r.status === 'in_progress') {
        // 续考：直接返回原快照，倒计时按原 deadline 走
        return {
          ok: true,
          resumed: true,
          enrollmentId: r._id,
          questions: r.questions,
          answers: r.answers || {},
          deadline: new Date(r.deadline).getTime(),
          startedAt: new Date(r.startedAt).getTime(),
          total: r.total,
          durationMs: (durationMin || 0) * 60 * 1000,
          isMock: r.isMock
        }
      }
    }

    // ── 3) 抽题
    const qRes = await db.collection('questions')
      .where({ examid: subjectId })
      .limit(1000)   // 单题库一般几十题；如果题库巨大需要 skip 分页
      .get()
    const pool = qRes.data || []
    if (pool.length === 0) {
      return { ok: false, code: 'NO_QUESTIONS', message: '该题库暂无题目，请联系 HR' }
    }
    const picked = pickRandom(pool, questionCount)
    const total = picked.length    // 真实抽到的数量（可能小于配置）

    // ── 4) 剥离答案
    const questions = []
    const answersOfficial = []
    picked.forEach(q => {
      const [stripped, ans] = stripAnswer(q)
      questions.push(stripped)
      answersOfficial.push(ans)
    })

    // ── 5) 写入 enrollment 快照
    const enrollmentDoc = {
      _id: enrollmentId,
      assessmentId,
      isMock,
      openid: OPENID,
      employeeId: emp._id,
      status: 'in_progress',
      questions,
      answersOfficial,
      answers: {},
      score: null,
      total,
      startedAt,
      submittedAt: null,
      deadline,
      switchCount: 0,
      clientLastSavedAt: startedAt
    }

    await db.collection('examEnrollments').add({ data: enrollmentDoc })

    return {
      ok: true,
      resumed: false,
      enrollmentId,
      questions,
      answers: {},
      deadline: deadline.getTime(),
      startedAt: startedAt.getTime(),
      total,
      durationMs: (durationMin || 0) * 60 * 1000,
      isMock
    }
  } catch (err) {
    console.error('[enterExam] error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
