// cloudfunctions/hrListQuestions/index.js
//
// 用途：HR 列出题目。两种模式：
//   1) 指定题库 (examid)：按题库分页列出，可选按 typecode 过滤
//   2) 全局模式 (不传 examid)：拉全部题目，每条带题库名，用于"题目管理"独立入口
//
// 入参：
//   { examid?: string, typecode?: '01'|'02'|'03'|'', skip?: number, limit?: number, _id?: string }
//   - 传 _id 时按主键直查单条（需校验 examid 一致，如传了 examid）
//
// 返回：
//   { ok, list: [题目对象（保留 options.value，HR 需要看到正确答案）+ subjectName], total, skip, limit }

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

  // 单条查询模式（编辑页拉详情）
  const qid = String(event._id || '').trim()
  if (qid) {
    try {
      const one = await db.collection('questions').doc(qid).get().catch(() => null)
      const item = one && one.data
      if (!item) return { ok: true, total: 0, skip: 0, limit: 1, list: [] }
      // 传了 examid 时校验一致
      if (examid && item.examid !== examid) {
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

  const where = {}
  if (examid) where.examid = examid
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

    const list = dataRes.data || []

    // 全局模式下（无 examid），拼上题库名方便前端展示
    if (!examid && list.length > 0) {
      const subjectIds = [...new Set(list.map(q => q.examid).filter(Boolean))]
      if (subjectIds.length > 0) {
        const subRes = await db.collection('subjects')
          .where({ _id: db.command.in(subjectIds) })
          .field({ _id: true, name: true })
          .limit(100)
          .get()
        const nameMap = {}
        ;(subRes.data || []).forEach(s => { nameMap[s._id] = s.name || s._id })
        list.forEach(q => { q.subjectName = nameMap[q.examid] || q.examid || '未知题库' })
      }
    }

    return { ok: true, total, skip, limit, list }
  } catch (err) {
    console.error('[hrListQuestions] error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
