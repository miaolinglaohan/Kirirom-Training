// cloudfunctions/hrSaveQuestion/index.js
//
// 用途：HR 新建或更新题目（questions 集合）。
//
// 入参：
//   {
//     _id?: string,          // 不传 = 新建，自动生成；传 = 更新
//     isCreate?: boolean,    // 显式新建模式，默认根据 _id 推断
//     examid: string,        // 必填，指向 subjects._id
//     title: string,         // 题干
//     typecode: '01'|'02'|'03',  // 单选/多选/判断
//     options: [{code, content, value: '0'|'1'}],  // 至少 2 项
//     comments?: string      // 解析
//   }
//
// 返回：{ ok, _id, mode } 或 { ok:false, code, message }
//
// 校验：
//   - examid 必须存在于 subjects
//   - title 非空
//   - typecode 三选一
//   - options ≥ 2 项；每项 code 唯一；code 仅大写字母；value 仅 '0' / '1'
//   - 至少 1 项 value='1'
//   - 单选/判断：恰好 1 项正确；多选：≥ 2 项正确（多选只有 1 项正确等同单选，强制 ≥2）
//   - 判断：恰好 2 项 options

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

const TYPE_NAMES = { '01': '单选', '02': '多选', '03': '判断' }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const g = await requireHr(OPENID)
  if (g.err) return g.err

  const _id = event._id ? String(event._id).trim() : ''
  const isCreate = event.isCreate != null ? !!event.isCreate : !_id
  const examid = String(event.examid || '').trim()
  const title = String(event.title || '').trim()
  const typecode = String(event.typecode || '').trim()
  const comments = String(event.comments || '').trim()
  const rawOptions = Array.isArray(event.options) ? event.options : []

  if (!examid) return { ok: false, code: 'MISSING_EXAMID', message: '缺少 examid' }
  if (!title) return { ok: false, code: 'MISSING_TITLE', message: '题干必填' }
  if (!TYPE_NAMES[typecode]) {
    return { ok: false, code: 'INVALID_TYPECODE', message: 'typecode 必须是 01 / 02 / 03' }
  }

  // 校验 examid 存在
  try {
    const sr = await db.collection('subjects').where({ _id: examid }).limit(1).get()
    if (!sr.data || sr.data.length === 0) {
      return { ok: false, code: 'EXAMID_NOT_FOUND', message: '指定题库不存在' }
    }
  } catch (err) {
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }

  // 校验 options
  if (rawOptions.length < 2) {
    return { ok: false, code: 'NOT_ENOUGH_OPTIONS', message: '至少需要 2 个选项' }
  }
  if (typecode === '03' && rawOptions.length !== 2) {
    return { ok: false, code: 'JUDGE_NEED_TWO', message: '判断题必须且仅有 2 个选项' }
  }

  const codes = new Set()
  const options = []
  for (let i = 0; i < rawOptions.length; i++) {
    const o = rawOptions[i] || {}
    const code = String(o.code || '').trim().toUpperCase()
    const content = String(o.content || '').trim()
    const value = String(o.value || '0').trim()
    if (!code || !/^[A-Z]$/.test(code)) {
      return { ok: false, code: 'INVALID_OPTION_CODE', message: `第 ${i + 1} 个选项的 code 必须是单个大写字母` }
    }
    if (codes.has(code)) {
      return { ok: false, code: 'DUP_OPTION_CODE', message: `选项 ${code} 重复` }
    }
    codes.add(code)
    if (!content) {
      return { ok: false, code: 'EMPTY_OPTION_CONTENT', message: `选项 ${code} 内容必填` }
    }
    if (value !== '0' && value !== '1') {
      return { ok: false, code: 'INVALID_OPTION_VALUE', message: `选项 ${code} 的 value 只能是 0 或 1` }
    }
    options.push({ code, content, value })
  }

  const correctCount = options.filter(o => o.value === '1').length
  if (correctCount === 0) {
    return { ok: false, code: 'NO_CORRECT_ANSWER', message: '至少需要 1 个正确选项' }
  }
  if (typecode === '01' && correctCount !== 1) {
    return { ok: false, code: 'SINGLE_NEED_ONE_CORRECT', message: '单选题只能有 1 个正确选项' }
  }
  if (typecode === '03' && correctCount !== 1) {
    return { ok: false, code: 'JUDGE_NEED_ONE_CORRECT', message: '判断题只能有 1 个正确选项' }
  }
  if (typecode === '02' && correctCount < 2) {
    return { ok: false, code: 'MULTI_NEED_TWO_CORRECT', message: '多选题至少要有 2 个正确选项' }
  }

  const docBody = {
    examid,
    title,
    typecode,
    typename: TYPE_NAMES[typecode],
    options,
    comments
  }

  try {
    if (isCreate) {
      // 新建：允许传 _id 自定义，传了则先查重；不传则自动生成
      if (_id) {
        const ex = await db.collection('questions').where({ _id }).limit(1).get()
        if (ex.data && ex.data.length > 0) {
          return { ok: false, code: 'ID_EXISTS', message: '题目编号已存在' }
        }
        await db.collection('questions').add({ data: Object.assign({ _id }, docBody) })
        return { ok: true, _id, mode: 'create' }
      } else {
        const r = await db.collection('questions').add({ data: docBody })
        return { ok: true, _id: r._id, mode: 'create' }
      }
    } else {
      if (!_id) return { ok: false, code: 'MISSING_ID', message: '更新模式必须带 _id' }
      const ex = await db.collection('questions').where({ _id }).limit(1).get()
      if (!ex.data || ex.data.length === 0) {
        return { ok: false, code: 'NOT_FOUND', message: '要更新的题目不存在' }
      }
      await db.collection('questions').doc(_id).update({ data: docBody })
      return { ok: true, _id, mode: 'update' }
    }
  } catch (err) {
    console.error('[hrSaveQuestion] save error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
