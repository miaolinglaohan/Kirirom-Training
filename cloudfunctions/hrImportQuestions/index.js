// cloudfunctions/hrImportQuestions/index.js
//
// 用途：HR 批量导入题目到指定题库。
//
// 入参：{ csv: string, subjectId: string }
//   CSV 列：题型, 题干, 选项A, 选项B, 选项C, 选项D, 选项E, 选项F, 正确答案, 解析
//   （选项C~F 可选，按非空列动态识别 2~6 个选项）
//   subjectId = 目标题库 _id，CSV 中的题库ID 列被忽略
//
// 返回：{ ok, inserted, errors: [{ row, msg }] }
//
// 校验规则与 hrSaveQuestion 一致：
//   题型三选一 / 题干必填 / 选项 2~8 / code 大写字母 / 正确答案数符合题型要求

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

// CSV 解析（同 hrImportEmployees，支持引号包裹）
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else { inQuotes = false }
      } else {
        field += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        row.push(field); field = ''
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++
        row.push(field); field = ''
        rows.push(row); row = []
      } else {
        field += ch
      }
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

const TYPE_MAP = { '单选': '01', '多选': '02', '判断': '03' }
const TYPE_NAME = { '01': '单选', '02': '多选', '03': '判断' }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const g = await requireHr(OPENID)
  if (g.err) return g.err

  const csv = String(event.csv || '')
  const subjectId = String(event.subjectId || '').trim()
  if (!csv.trim()) {
    return { ok: false, code: 'EMPTY_CSV', message: 'CSV 内容为空' }
  }
  if (!subjectId) {
    return { ok: false, code: 'MISSING_SUBJECT', message: '请先选择题库' }
  }

  // 校验题库存在
  try {
    const subRes = await db.collection('subjects').where({ _id: subjectId }).limit(1).get()
    if (!subRes.data || subRes.data.length === 0) {
      return { ok: false, code: 'SUBJECT_NOT_FOUND', message: '题库不存在' }
    }
  } catch (err) {
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }

  try {
    const rows = parseCSV(csv)
    if (rows.length < 2) {
      return { ok: false, code: 'NO_DATA', message: 'CSV 没有数据行' }
    }

    const header = rows[0].map(h => h.trim())
    // 定位列索引（兼容中英文表头）
    const typeIdx = header.findIndex(h => h === '题型' || h.toLowerCase() === 'type')
    const titleIdx = header.findIndex(h => h === '题干' || h.toLowerCase() === 'title')
    const optIdx = []
    for (const code of ['A', 'B', 'C', 'D', 'E', 'F']) {
      const idx = header.findIndex(h => h === `选项${code}` || h.toLowerCase() === `option${code.toLowerCase()}`)
      optIdx.push(idx)
    }
    const answerIdx = header.findIndex(h => h === '正确答案' || h.toLowerCase() === 'answer')
    const commentIdx = header.findIndex(h => h === '解析' || h.toLowerCase() === 'comment')

    if (typeIdx < 0 || titleIdx < 0 || answerIdx < 0) {
      return { ok: false, code: 'BAD_HEADER', message: 'CSV 表头缺少"题型"、"题干"或"正确答案"列' }
    }

    let inserted = 0
    const errors = []

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]
      if (row.length === 1 && !row[0].trim()) continue  // 空行

      const typeText = (row[typeIdx] || '').trim()
      const title = (row[titleIdx] || '').trim()
      const answerText = (row[answerIdx] || '').trim()

      // 校验题型
      if (!typeText) { errors.push({ row: r + 1, msg: '题型为空' }); continue }
      const typecode = TYPE_MAP[typeText]
      if (!typecode) { errors.push({ row: r + 1, msg: `题型"${typeText}"无效（应为 单选/多选/判断）` }); continue }

      // 校验题干
      if (!title) { errors.push({ row: r + 1, msg: '题干为空' }); continue }

      // 收集选项（按 A→F 顺序，遇到空列截止）
      const options = []
      let stopped = false
      for (let i = 0; i < 6; i++) {
        const idx = optIdx[i]
        if (idx < 0) { stopped = true; break }  // 表头没这列
        const content = (row[idx] || '').trim()
        if (!content) { stopped = true; break }  // 空列截止
        if (stopped) break
        options.push({ code: String.fromCharCode(65 + i), content, value: '0' })
      }

      // 判断题特殊处理：强制 2 选项，内容固定
      if (typecode === '03') {
        if (options.length !== 2) {
          // 重建为标准判断题选项
          options.length = 0
          options.push({ code: 'A', content: '正确', value: '0' })
          options.push({ code: 'B', content: '错误', value: '0' })
        } else {
          options[0].content = '正确'
          options[1].content = '错误'
        }
      }

      if (options.length < 2) { errors.push({ row: r + 1, msg: '选项不足 2 个' }); continue }
      if (options.length > 8) { errors.push({ row: r + 1, msg: '选项超过 8 个' }); continue }

      // 解析正确答案
      const correctCodes = answerText.split(/[;；,，]/).map(s => s.trim().toUpperCase()).filter(Boolean)
      if (correctCodes.length === 0) { errors.push({ row: r + 1, msg: '正确答案为空' }); continue }

      // 校验正确答案合法性
      const validCodes = options.map(o => o.code)
      for (const c of correctCodes) {
        if (validCodes.indexOf(c) < 0) {
          errors.push({ row: r + 1, msg: `正确答案"${c}"超出选项范围(${validCodes.join(',')})` })
          break
        }
      }
      if (errors.length > 0 && errors[errors.length - 1].row === r + 1) continue

      // 题型校验正确答案数量
      if (typecode === '01' && correctCodes.length !== 1) {
        errors.push({ row: r + 1, msg: '单选题正确答案必须为 1 个' }); continue
      }
      if (typecode === '03' && correctCodes.length !== 1) {
        errors.push({ row: r + 1, msg: '判断题正确答案必须为 1 个' }); continue
      }
      if (typecode === '02' && correctCodes.length < 2) {
        errors.push({ row: r + 1, msg: '多选题正确答案至少 2 个' }); continue
      }

      // 标记正确选项 value=1
      correctCodes.forEach(code => {
        const opt = options.find(o => o.code === code)
        if (opt) opt.value = '1'
      })

      const comment = commentIdx >= 0 ? (row[commentIdx] || '').trim() : ''

      // 写入
      try {
        await db.collection('questions').add({
          data: {
            title,
            typecode,
            typename: TYPE_NAME[typecode],
            options,
            comments: comment || undefined,
            examid: subjectId
          }
        })
        inserted++
      } catch (err) {
        errors.push({ row: r + 1, msg: `写入失败: ${err.errMsg || String(err)}` })
      }
    }

    return { ok: true, inserted, errors }
  } catch (err) {
    console.error('[hrImportQuestions] error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
