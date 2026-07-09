// cloudfunctions/submitExam/index.js
//
// 用途：交卷。服务端判分、写 historys（非模考）、更新 enrollment 状态。
//
// 入参：
//   { enrollmentId: string, answers: object }
//
// 返回：
//   { ok: true, score, fullScore, total, rightNum, switchCount,
//     questions,            // 题目快照
//     answersOfficial,      // 仅在模考或允许 review 时返回
//     userAnswers,
//     scoreDetail,
//     questionConfig,
//     isMock
//   }
//   { ok: false, code, message }
//
// 判分规则（Phase 3 严格判分）：
//   - 用户答案集合 ≡ 官方答案集合（顺序无关）才算正确，得该题满分
//   - 任何错选 / 漏选 / 多选均 0 分
//   - 题目按 typecode 取分值：
//       '01' 单选 → questionConfig.single.score
//       '02' 多选 → questionConfig.multi.score
//       '03' 判断 → questionConfig.judge.score
//   - 兼容旧考卷：若 enrollment 无 questionConfig，每题统一按 1 分计（=rightNum）
//
// 注意：
//   - 即使 deadline 已过仍允许提交一次（应对客户端自动交卷在 deadline 后到达的场景）
//   - 已 submitted 的拒绝重复提交
//   - 正式考试写一条 historys 记录，保持与既有 history/review 页兼容
//     （字段：_id, subject, items, rightNum, createTime, score, fullScore, scoreDetail, ...）

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// 把任意答案标准化成排好序、去重的小写字符串（用于集合比较）
function normalizeCodes(v) {
  if (v == null) return ''
  let arr
  if (Array.isArray(v)) arr = v
  else arr = String(v).split('')
  return arr
    .map(x => String(x).trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .join(',')
}

// 把时间戳格式化为 YYYY-MM-DD HH:mm:ss（兼容原 util.getTime 输出）
function formatTime(d) {
  const pad = n => (n < 10 ? '0' + n : '' + n)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
         ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
}

// Phase 3: 按 typecode 返回单题分值。无 config 时回退到 1 分/题。
function scoreOfType(typecode, config) {
  if (!config) return 1
  const tc = String(typecode || '01')
  if (tc === '02') return Number(config.multi && config.multi.score) || 0
  if (tc === '03') return Number(config.judge && config.judge.score) || 0
  return Number(config.single && config.single.score) || 0
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, code: 'NO_OPENID', message: '无法获取微信身份' }

  const enrollmentId = String(event.enrollmentId || '').trim()
  const userAnswers = (event.answers && typeof event.answers === 'object') ? event.answers : {}
  if (!enrollmentId) return { ok: false, code: 'MISSING_ID', message: '缺少 enrollmentId' }

  try {
    const rRes = await db.collection('examEnrollments').doc(enrollmentId).get().catch(() => null)
    if (!rRes || !rRes.data) {
      return { ok: false, code: 'NOT_FOUND', message: '答卷不存在' }
    }
    const r = rRes.data
    if (r.openid !== OPENID) {
      return { ok: false, code: 'FORBIDDEN', message: '无权操作该答卷' }
    }
    if (r.status === 'submitted') {
      return { ok: false, code: 'ALREADY_SUBMITTED', message: '该答卷已提交，请勿重复' }
    }

    // ── 判分
    const officialMap = {}
    ;(r.answersOfficial || []).forEach(a => {
      officialMap[a.qid] = normalizeCodes(a.correctCodes)
    })

    const questionConfig = r.questionConfig || null
    let rightNum = 0
    let score = 0
    let fullScore = 0
    const perQuestion = []
    const scoreDetail = []
    ;(r.questions || []).forEach(q => {
      const u = normalizeCodes(userAnswers[q._id])
      const o = officialMap[q._id] || ''
      const right = (u !== '' && u === o)
      if (right) rightNum++
      const full = scoreOfType(q.typecode, questionConfig)
      const earned = right ? full : 0
      score += earned
      fullScore += full
      perQuestion.push({ qid: q._id, userCodes: u, correctCodes: o, right })
      scoreDetail.push({ qid: q._id, typecode: q.typecode || '01', earned, full })
    })

    const total = r.total || (r.questions || []).length
    // 优先用 enrollment 上固化的 fullScore（建卷时已算好），保证与 questionConfig 一致；
    // 若旧考卷无此字段，回退到本次累加结果（旧行为 = total × 1）
    if (typeof r.fullScore === 'number' && r.fullScore > 0) {
      fullScore = r.fullScore
    }
    const submittedAt = new Date()

    // ── 更新 enrollment
    await db.collection('examEnrollments').doc(enrollmentId).update({
      data: {
        answers: userAnswers,
        status: 'submitted',
        score,
        rightNum,
        scoreDetail,
        submittedAt
      }
    })

    // ── 写 historys（模考 + 正式考都写；错题本统一从 historys 拿数据）
    //    模考记录用 isMock:true 打标，history 页（"我的考试记录"）过滤掉模考避免噪声，
    //    mistakes 页（错题本）则不过滤，能自然收到模考错题。
    {
      // 取关联科目名，便于历史页/错题本展示
      let subject = { _id: '', name: r.isMock ? '模拟考试' : '正式考试' }
      let assessmentName = ''
      try {
        // 通过任一题目反查 subjectId
        const firstQ = (r.questions && r.questions[0]) || null
        const subjectId = firstQ && firstQ.examid
        if (subjectId) {
          const sRes = await db.collection('subjects').doc(subjectId).get().catch(() => null)
          if (sRes && sRes.data) {
            subject = { _id: sRes.data._id, name: sRes.data.name }
          }
        }
      } catch (e) {
        console.warn('[submitExam] 取 subject 失败，使用默认', e)
      }
      if (r.assessmentId) {
        try {
          const aRes = await db.collection('assessments').doc(r.assessmentId).get().catch(() => null)
          if (aRes && aRes.data) {
            assessmentName = aRes.data.name || aRes.data.title || ''
          }
        } catch (e) {
          console.warn('[submitExam] 取 assessment 失败，使用题库名兜底', e)
        }
      }

      const histDoc = {
        // 关键：云函数 add 不会自动注入 _openid，必须显式带上，
        // 否则客户端 historys/错题本 页的 where({_openid}) 查询将拿不到该记录。
        _openid: OPENID,
        // 兼容原 historys 必填字段：subject / items / rightNum / createTime
        subject,
        items: r.questions,         // 题目快照（不含 value）
        // options_arr / score_arr / question 等旧字段：原 exam.js 用于复盘渲染；
        // 这里写空数组占位，避免老页面 undefined。复盘真正的来源建议从 enrollment 读。
        question: '',
        options_arr: [],
        score_arr: perQuestion.map(p => p.right ? 1 : 0),
        rightNum,
        createTime: formatTime(submittedAt),
        createTimeMs: submittedAt.getTime(),
        displayName: assessmentName || subject.name,
        assessmentName,
        // 新增追加字段，标识来自考试系统
        enrollmentId,
        assessmentId: r.assessmentId,
        total,
        // Phase 3: 配置化分制
        score,
        fullScore,
        scoreDetail,
        questionConfig,
        switchCount: r.switchCount || 0,
        // 用户作答快照（用于复盘"您的选择"展示）
        userAnswers,
        // 官方答案快照（培训系统：复盘展示标准答案，供员工对照学习）
        answersOfficial: r.answersOfficial || [],
        // 区分模考与正式考：history 页据此过滤
        isMock: r.isMock === true
      }

      try {
        await db.collection('historys').add({ data: histDoc })
      } catch (e) {
        console.error('[submitExam] 写 historys 失败（不阻断主流程）', e)
      }
    }

    // ── 返回
    const resp = {
      ok: true,
      score,
      fullScore,
      rightNum,
      total,
      scoreDetail,
      questionConfig,
      switchCount: r.switchCount || 0,
      isMock: !!r.isMock,
      questions: r.questions,
      userAnswers
    }
    // 培训系统：交卷后即可返回官方答案 + 逐题判分供前端 examresult 渲染
    resp.answersOfficial = r.answersOfficial || []
    resp.perQuestion = perQuestion
    return resp
  } catch (err) {
    console.error('[submitExam] error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
