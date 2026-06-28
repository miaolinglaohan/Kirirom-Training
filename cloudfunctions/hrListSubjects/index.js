// cloudfunctions/hrListSubjects/index.js
//
// 用途：HR 列出所有题库（subjects 集合），附题型分桶统计。
//   subjects 是"题目挂载的实体"，对应 questions.examid 与 assessments.subjectId
//
// 入参：{}
// 返回：
//   {
//     ok, total,
//     exams: [{_id, name}],   // 一级试卷（供前端按 pid 分组渲染）
//     list:  [{_id, name, pid, questionCount: {single,multi,judge,total}}]
//   }

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate

async function requireHr(OPENID) {
  if (!OPENID) return { err: { ok: false, code: 'NO_OPENID', message: '无法获取微信身份' } }
  const r = await db.collection('employees').where({ openid: OPENID }).limit(1).get()
  const me = r.data[0]
  if (!me || me.active === false || (me.role !== 'hr' && me.role !== 'admin')) {
    return { err: { ok: false, code: 'FORBIDDEN', message: '没有 HR 权限' } }
  }
  return { me }
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const g = await requireHr(OPENID)
  if (g.err) return g.err

  try {
    // 拉 subjects 列表
    const sRes = await db.collection('subjects').limit(500).get()
    const subjects = sRes.data || []

    // 拉 exams 用于前端分组渲染
    const eRes = await db.collection('exam').limit(200).get()
    const exams = (eRes.data || []).map(x => ({ _id: x._id, name: x.name || x._id }))

    // 聚合 questions 集合：按 (examid, typecode) 分桶计数
    // 用 aggregate group 一次性返回所有 subject × typecode 计数
    let bucketRows = []
    try {
      const agg = await db.collection('questions')
        .aggregate()
        .group({
          _id: { examid: '$examid', typecode: '$typecode' },
          count: $.sum(1)
        })
        .limit(2000)
        .end()
      bucketRows = agg.list || []
    } catch (err) {
      // 聚合失败兜底：逐 subject 查（性能较差但保证可用）
      console.warn('[hrListSubjects] aggregate fallback', err)
      bucketRows = []
      for (const s of subjects) {
        const qRes = await db.collection('questions')
          .where({ examid: s._id })
          .field({ typecode: true })
          .limit(1000)
          .get()
        const counter = {}
        ;(qRes.data || []).forEach(q => {
          const tc = String(q.typecode || '01')
          counter[tc] = (counter[tc] || 0) + 1
        })
        Object.keys(counter).forEach(tc => {
          bucketRows.push({ _id: { examid: s._id, typecode: tc }, count: counter[tc] })
        })
      }
    }

    // 把聚合结果归并到每个 subject
    const statMap = {}  // statMap[examid] = {single,multi,judge,total}
    bucketRows.forEach(row => {
      const examid = row._id && row._id.examid
      const tc = row._id && row._id.typecode
      const c = Number(row.count) || 0
      if (!examid) return
      if (!statMap[examid]) statMap[examid] = { single: 0, multi: 0, judge: 0, total: 0 }
      statMap[examid].total += c
      if (tc === '01') statMap[examid].single += c
      else if (tc === '02') statMap[examid].multi += c
      else if (tc === '03') statMap[examid].judge += c
    })

    const list = subjects.map(s => ({
      _id: s._id,
      name: s.name || '',
      pid: s.pid || '',
      questionCount: statMap[s._id] || { single: 0, multi: 0, judge: 0, total: 0 }
    }))

    return { ok: true, total: list.length, list, exams }
  } catch (err) {
    console.error('[hrListSubjects] error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
