// cloudfunctions/hrSaveAssessment/index.js
//
// 用途：HR 新建或更新一场考试。
//
// 入参：
//   {
//     _id?: string,           // 不传 = 新建；传 = 更新
//     name: string,
//     subjectId: string,      // 对应 exam 集合的 _id
//     startTime: string,      // 'YYYY-MM-DD HH:mm:ss' 或 ISO 字符串
//     duration: number,       // 分钟
//     validHours: number,     // 有效期（小时）：开考后多少小时内可进场，1~168
//     questionConfig: {
//       single: { count, score },
//       multi:  { count, score },
//       judge:  { count, score }
//     },
//     targetDepts?: string[], // 空数组 = 全员
//     visible?: boolean
//   }
//
// 返回：
//   { ok: true, _id, mode: 'create'|'update', fullScore, totalQuestions }
//   { ok: false, code, message, detail? }
//
// 校验规则：
//   - 必填：name / subjectId / startTime / duration / questionConfig
//   - startTime 必须能解析为有效 Date
//   - duration > 0
//   - 三类 count >= 0、score >= 0，且 count+count+count > 0
//   - 题库存在
//   - 题库中各 typecode 的题量 >= 对应 config[type].count
//     不足返回 NOT_ENOUGH_QUESTIONS，detail = [{typecode, need, have}]

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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const g = await requireHr(OPENID)
  if (g.err) return g.err

  const _id = event._id ? String(event._id).trim() : ''
  const name = String(event.name || '').trim()
  const subjectId = String(event.subjectId || '').trim()
  const startTime = String(event.startTime || '').trim()
  const duration = Number(event.duration) || 0
  const validHours = Number(event.validHours) || 0
  const questionConfig = normalizeConfig(event.questionConfig)
  const targetDepts = Array.isArray(event.targetDepts) ? event.targetDepts.map(String).filter(Boolean) : []
  const visible = event.visible !== false  // 默认 true

  // ── 基本字段校验
  if (!name) return { ok: false, code: 'MISSING_NAME', message: '考试名称必填' }
  if (!subjectId) return { ok: false, code: 'MISSING_SUBJECT', message: '请选择题库' }
  if (!startTime) return { ok: false, code: 'MISSING_START', message: '请设置开始时间' }
  const startMs = new Date(startTime).getTime()
  if (!Number.isFinite(startMs)) {
    return { ok: false, code: 'INVALID_START', message: '开始时间格式无效' }
  }
  if (!(duration > 0)) return { ok: false, code: 'INVALID_DURATION', message: '时长必须大于 0 分钟' }
  if (!(validHours > 0)) return { ok: false, code: 'INVALID_VALID_HOURS', message: '有效期必须大于 0 小时' }
  if (validHours > 168) return { ok: false, code: 'INVALID_VALID_HOURS', message: '有效期不能超过 168 小时（7 天）' }

  // ── questionConfig 校验
  const totalNeed =
    questionConfig.single.count + questionConfig.multi.count + questionConfig.judge.count
  if (totalNeed <= 0) {
    return { ok: false, code: 'EMPTY_CONFIG', message: '题量配置不能全为 0' }
  }
  // score 允许为 0（题型不参与计分），count 不能为负
  for (const k of ['single', 'multi', 'judge']) {
    if (questionConfig[k].count < 0 || questionConfig[k].score < 0) {
      return { ok: false, code: 'NEGATIVE_VALUE', message: '题量和分值不能为负数' }
    }
  }

  // ── 题库存在性校验（subjectId 指向 subjects._id，非 exam._id）
  let subjectName = ''
  try {
    const exRes = await db.collection('subjects').where({ _id: subjectId }).limit(1).get()
    if (!exRes.data || exRes.data.length === 0) {
      return { ok: false, code: 'SUBJECT_NOT_FOUND', message: '指定的题库不存在' }
    }
    subjectName = exRes.data[0].name || ''
  } catch (err) {
    console.error('[hrSaveAssessment] check subject error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }

  // ── 题库分桶题量预检（提交前校验，按 Phase3 规划"细节 4 选 A"）
  try {
    const qRes = await db.collection('questions')
      .where({ examid: subjectId })
      .field({ typecode: true })
      .limit(1000)
      .get()
    const buckets = { '01': 0, '02': 0, '03': 0 }
    ;(qRes.data || []).forEach(q => {
      const tc = String(q.typecode || '01')
      if (buckets[tc] != null) buckets[tc]++
    })
    const need = {
      '01': questionConfig.single.count,
      '02': questionConfig.multi.count,
      '03': questionConfig.judge.count
    }
    const shortages = []
    Object.keys(need).forEach(tc => {
      if (need[tc] > buckets[tc]) {
        shortages.push({ typecode: tc, need: need[tc], have: buckets[tc] })
      }
    })
    if (shortages.length > 0) {
      return {
        ok: false,
        code: 'NOT_ENOUGH_QUESTIONS',
        message: '题库中某类型题目数量不足',
        detail: shortages
      }
    }
  } catch (err) {
    console.error('[hrSaveAssessment] check pool error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }

  // ── 派生字段
  const totalQuestions = totalNeed
  const fullScore =
    questionConfig.single.count * questionConfig.single.score +
    questionConfig.multi.count  * questionConfig.multi.score +
    questionConfig.judge.count  * questionConfig.judge.score

  const docBody = {
    name,
    subjectId,
    subjectName,                 // 冗余存一份，列表展示用
    startTime,
    duration,
    validHours,                  // 有效期（小时）：开考后 validHours 内可进场，个人计时
    questionConfig,
    targetDepts,
    visible,
    // 旧字段 questionCount 同步写一份，便于历史代码兼容
    questionCount: totalQuestions
  }

  try {
    if (_id) {
      // 更新模式
      const existing = await db.collection('assessments').doc(_id).get().catch(() => null)
      if (!existing || !existing.data) {
        return { ok: false, code: 'NOT_FOUND', message: '要更新的考试不存在' }
      }
      // 已提前结束的考试不允许再编辑（防止改时间"复活"）
      if (existing.data.endedAt) {
        return { ok: false, code: 'ALREADY_ENDED', message: '该考试已提前结束，不可编辑' }
      }
      // 已过期（按有效窗口算）的考试也不允许编辑
      const exStart = new Date(existing.data.startTime || 0).getTime()
      const exValidHours = Number(existing.data.validHours) || 0
      const exDuration = (existing.data.duration || 0) * 60 * 1000
      const exValidUntil = exValidHours > 0
        ? exStart + exValidHours * 60 * 60 * 1000
        : exStart + exDuration
      if (Date.now() > exValidUntil) {
        return { ok: false, code: 'EXPIRED', message: '该考试已结束，不可编辑' }
      }
      docBody.updatedAt = new Date()
      docBody.updatedBy = g.me._id
      await db.collection('assessments').doc(_id).update({ data: docBody })
      return { ok: true, _id, mode: 'update', fullScore, totalQuestions }
    } else {
      // 新建模式
      docBody.createTime = new Date()
      docBody.createdBy = g.me._id
      const addRes = await db.collection('assessments').add({ data: docBody })
      return { ok: true, _id: addRes._id, mode: 'create', fullScore, totalQuestions }
    }
  } catch (err) {
    console.error('[hrSaveAssessment] save error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
