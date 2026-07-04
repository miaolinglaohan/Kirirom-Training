// cloudfunctions/enterExam/index.js
//
// 用途：员工进入考场。两种模式：
//   1) 正式考试 (isMock=false): 必须传 assessmentId，云函数从 assessments 集合读规则
//   2) 模拟考试 (isMock=true): 传 subjectId + 可选 questionConfig / questionCount / duration
//
// 核心职责：
//   ① 校验：员工已激活、考试可见、未停用、未过时、部门在 targetDepts 范围内
//   ② 防重入：用 _id = "{assessmentId}_{openid}" 防止同一人重复创建多卷
//   ③ 抽题：从 questions 集合按 subjectId + typecode 分桶随机抽题（Phase 3）
//   ④ 剥离答案：写入 enrollment 前移除 options[].value，另存 answersOfficial
//   ⑤ 固化 deadline：
//      正式考（有 validHours）= 进场时刻 + duration（个人计时，有效期窗口内随时进，照常考完整时长）
//      正式考（无 validHours，存量旧考试）= assessment.startTime + duration（全员统一截止）
//      模考    = now + duration（每场独立计时）
//
// 入参：
//   { assessmentId: string } 正式
//   { isMock: true, subjectId: string, questionConfig?: {...}, questionCount?: number, duration?: number } 模考
//
// Phase 3 questionConfig 结构：
//   { single: {count, score}, multi: {count, score}, judge: {count, score} }
//
// 返回：
//   { ok: true, enrollmentId, questions, deadline, total, fullScore, questionConfig, durationMs, startedAt, isMock }
//   { ok: false, code, message, detail? }
//
// 可能的错误码：
//   NO_OPENID / UNACTIVATED / DISABLED / MISSING_SUBJECT / MISSING_ASSESSMENT /
//   ASSESSMENT_NOT_FOUND / NOT_VISIBLE / NOT_STARTED / EXPIRED / NOT_IN_SCOPE /
//   ALREADY_SUBMITTED / NO_QUESTIONS / EMPTY_CONFIG / NOT_ENOUGH_QUESTIONS / DB_ERROR

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

// Phase 3: 兼容旧 questionCount (一律视为单选 1 分/题)
function deriveConfigFromCount(n) {
  return {
    single: { count: Number(n) || 0, score: 1 },
    multi:  { count: 0, score: 0 },
    judge:  { count: 0, score: 0 }
  }
}

// Phase 3: 把可能不规范的 config 标准化（补全字段、转 number）
function normalizeConfig(c) {
  const pick = (o) => ({
    count: Number((o && o.count) || 0) || 0,
    score: Number((o && o.score) || 0) || 0
  })
  return {
    single: pick(c && c.single),
    multi:  pick(c && c.multi),
    judge:  pick(c && c.judge)
  }
}

// 类型键 -> typecode
const TYPECODE_OF = { single: '01', multi: '02', judge: '03' }

// Phase 3: 按 typecode 分桶抽题
// 返回 { picked: Question[], shortages: [{typecode, need, have}] }
function bucketPick(pool, config) {
  const byType = { '01': [], '02': [], '03': [] }
  pool.forEach(q => {
    const tc = String(q.typecode || '01')
    if (byType[tc]) byType[tc].push(q)
  })
  const picked = []
  const shortages = []
  ;['single', 'multi', 'judge'].forEach(k => {
    const need = config[k].count
    if (need <= 0) return
    const tc = TYPECODE_OF[k]
    const bucket = byType[tc]
    if (bucket.length < need) {
      shortages.push({ typecode: tc, need, have: bucket.length })
      return
    }
    picked.push(...pickRandom(bucket, need))
  })
  return { picked, shortages }
}

// Phase 3: 总分 = Σ (count × score)
function computeFullScore(config) {
  return config.single.count * config.single.score
       + config.multi.count  * config.multi.score
       + config.judge.count  * config.judge.score
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

    // ── 1) 解析考试规则（subjectId / duration / questionConfig / startTime / enrollmentId）
    let subjectId, durationMin, questionConfig, startedAt, deadline, enrollmentId, assessmentId

    const now = Date.now()

    if (isMock) {
      subjectId = String(event.subjectId || '').trim()
      if (!subjectId) return { ok: false, code: 'MISSING_SUBJECT', message: '模考缺少题库参数' }
      durationMin = Number(event.duration) > 0 ? Number(event.duration) : DEFAULT_MOCK_DURATION_MIN
      // 模考兼容：优先 event.questionConfig；其次旧 event.questionCount（一律视为单选）；
      // 最后走"默认覆盖三种题型"——配合下方 cap 逻辑，自动削到 pool 真实数量
      if (event.questionConfig) {
        questionConfig = normalizeConfig(event.questionConfig)
      } else if (Number(event.questionCount) > 0) {
        questionConfig = deriveConfigFromCount(Number(event.questionCount))
      } else {
        // Phase 3 fix: 模考默认就给三种题型都安排上限值，cap 阶段自动削；
        // 这样 HR 只放了 1 单 / 1 多 / 1 判，也能各抽 1 道；放满则上限 10 / 5 / 5
        questionConfig = {
          single: { count: 10, score: 1 },
          multi:  { count: 5,  score: 2 },
          judge:  { count: 5,  score: 1 }
        }
      }
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
      // 有效期：有 validHours 用 validUntil（开考后 N 小时）；旧考试无该字段回退到 startMs+duration（统一截止）
      const validHours = Number(a.validHours) || 0
      let validUntilMs = validHours > 0
        ? startMs + validHours * 60 * 60 * 1000
        : startMs + (a.duration || 0) * 60 * 1000  // 旧模型：到点统一结束
      // HR 提前结束：endedAt 截断 validUntil
      if (a.endedAt) {
        const endedMs = new Date(a.endedAt).getTime()
        if (Number.isFinite(endedMs) && endedMs < validUntilMs) validUntilMs = endedMs
      }

      if (now < startMs) return { ok: false, code: 'NOT_STARTED', message: '考试尚未开始' }
      if (now > validUntilMs) return { ok: false, code: 'EXPIRED', message: '考试有效期已过' }

      const targetDepts = Array.isArray(a.targetDepts) ? a.targetDepts : []
      if (targetDepts.length > 0 && targetDepts.indexOf(emp.dept) < 0) {
        return { ok: false, code: 'NOT_IN_SCOPE', message: '您不在本场考试目标部门内' }
      }

      subjectId = a.subjectId
      durationMin = a.duration
      // Phase 3: 优先用 questionConfig，旧考试回退到 questionCount
      questionConfig = a.questionConfig
        ? normalizeConfig(a.questionConfig)
        : deriveConfigFromCount(a.questionCount)
      startedAt = new Date(now)
      // deadline：
      //   新模型（validHours>0）：个人计时 = 进场时刻 + duration，允许超时答完（不受 validUntil 硬截断）
      //   旧模型（无 validHours）：统一截止 = startMs + duration，进场晚=时间少
      deadline = validHours > 0
        ? new Date(now + durationMin * 60 * 1000)
        : new Date(startMs + durationMin * 60 * 1000)
      enrollmentId = assessmentId + '_' + OPENID
    }

    // Phase 3 fix: 正式考校验 totalNeed > 0；模考宽容（counts 可能在抽题阶段被 cap 到 pool 真实数量）
    if (!isMock) {
      const totalNeed = questionConfig.single.count + questionConfig.multi.count + questionConfig.judge.count
      if (totalNeed <= 0) {
        return { ok: false, code: 'EMPTY_CONFIG', message: '考试题量配置为空，请联系 HR' }
      }
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
          fullScore: r.fullScore || null,
          questionConfig: r.questionConfig || null,
          durationMs: (durationMin || 0) * 60 * 1000,
          isMock: r.isMock
        }
      }
    }

    // ── 3) 抽题（Phase 3: 按 typecode 分桶）
    const qRes = await db.collection('questions')
      .where({ examid: subjectId })
      .limit(1000)   // 单题库一般几十题；如果题库巨大需要 skip 分页
      .get()
    const pool = qRes.data || []
    if (pool.length === 0) {
      return { ok: false, code: 'NO_QUESTIONS', message: '该题库暂无题目，请联系 HR' }
    }

    // Phase 3 fix: 模考宽容 —— 把每个类型的请求数 cap 到题库实际拥有的数量
    // 这样 HR 在题库里只放了 3 道单选时，模考请求 10 单选 + 5 多选 + 5 判断也能成功开考（实际抽 3 道）
    if (isMock) {
      const byCount = { '01': 0, '02': 0, '03': 0 }
      pool.forEach(q => {
        const tc = String(q.typecode || '01')
        if (byCount[tc] !== undefined) byCount[tc]++
      })
      if (questionConfig.single.count > byCount['01']) questionConfig.single.count = byCount['01']
      if (questionConfig.multi.count  > byCount['02']) questionConfig.multi.count  = byCount['02']
      if (questionConfig.judge.count  > byCount['03']) questionConfig.judge.count  = byCount['03']
    }

    // Phase 3: 总分 = Σ (count × score) —— 在 cap 之后计算，反映真实抽题量
    const fullScore = computeFullScore(questionConfig)

    const { picked, shortages } = bucketPick(pool, questionConfig)
    // 正式考严格校验题量不足；模考已经在上方 cap 过，理论上不会 short
    if (!isMock && shortages.length > 0) {
      return {
        ok: false,
        code: 'NOT_ENOUGH_QUESTIONS',
        message: '题库中某类型题目数量不足',
        detail: shortages
      }
    }
    const total = picked.length
    if (total === 0) {
      // cap 后所有桶都为 0（题库类型与请求类型完全错配），或正式考但所有 count 都为 0
      return { ok: false, code: 'NO_QUESTIONS', message: '该题库暂无可用题目，请联系 HR' }
    }

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
      fullScore,
      questionConfig,
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
      fullScore,
      questionConfig,
      durationMs: (durationMin || 0) * 60 * 1000,
      isMock
    }
  } catch (err) {
    console.error('[enterExam] error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
