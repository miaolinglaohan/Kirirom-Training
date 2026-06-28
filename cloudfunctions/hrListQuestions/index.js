// cloudfunctions/hrListQuestions/index.js
//
// 用途：HR 按题库 (examid) 分页列出题目；可选按 typecode 过滤。
//
// 入参：
//   { examid: string, typecode?: '01'|'02'|'03'|'', skip?: number, limit?: number, _id?: string }
//   - 传 _id 时按主键直查单条（仍要校验 examid 一致），用于编辑页拉取
//
// 返回：
//   { ok, list: [题目对象（保留 options.value，HR 需要看到正确答案）], total, skip, limit }

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

  const examid = String(event.examid || '').trim()
  if (!examid) return { ok: false, code: 'MISSING_EXAMID', message: '缺少题库 examid' }

  // 单条查询模式（编辑页拉详情）
  const qid = String(event._id || '').trim()
  if (qid) {
    try {
      const one = await db.collection('questions').doc(qid).get().catch(() => null)
      const item = one && one.data
      if (!item || item.examid !== examid) {
        return { ok: true, total: 0, skip: 0, limit: 1, list: [] }
      }
      return { ok: true, total: 1, skip: 0, limit: 1, list: [item] }
    } catch (err) {
      console.error('[hrListQuestions] get one error', err)
      return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
    }
  }

  const typecode = String(event.typecode || '').trim()
  let skip = Number(event.skip) || 0
  let limit = Number(event.limit) || 20
  if (skip < 0) skip = 0
  if (limit < 1) limit = 20
  if (limit > 100) limit = 100

  const where = { examid }
  if (typecode === '01' || typecode === '02' || typecode === '03') {
    where.typecode = typecode
  }

  try {
    const countRes = await db.collection('questions').where(where).count()
    const total = countRes.total || 0

    const dataRes = await db.collection('questions')
      .where(where)
      .skip(skip)
      .limit(limit)
      .get()

    return { ok: true, total, skip, limit, list: dataRes.data || [] }
  } catch (err) {
    console.error('[hrListQuestions] error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
