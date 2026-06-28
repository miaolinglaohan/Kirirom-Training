// cloudfunctions/saveDraft/index.js
//
// 用途：考试中定期保存草稿。客户端每答完一题或每 30 秒调用一次。
//
// 入参：
//   { enrollmentId: string, answers: object, switchCountIncrement?: number }
//
// 返回：
//   { ok: true, clientLastSavedAt: <Date>, switchCount: <number> }
//   { ok: false, code, message }
//
// 校验：
//   - openid 必须匹配 enrollment.openid（防止越权改别人答卷）
//   - status 必须是 in_progress
//   - now <= deadline + 容错 10s（允许时间到瞬间的最后一次保存）

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const SAVE_GRACE_MS = 10 * 1000  // 时间到后 10s 内仍允许 saveDraft

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, code: 'NO_OPENID', message: '无法获取微信身份' }

  const enrollmentId = String(event.enrollmentId || '').trim()
  const answers = (event.answers && typeof event.answers === 'object') ? event.answers : null
  const switchInc = Number(event.switchCountIncrement) > 0 ? Math.floor(event.switchCountIncrement) : 0

  if (!enrollmentId) return { ok: false, code: 'MISSING_ID', message: '缺少 enrollmentId' }
  if (!answers) return { ok: false, code: 'MISSING_ANSWERS', message: '缺少 answers' }

  try {
    const rRes = await db.collection('examEnrollments').doc(enrollmentId).get().catch(() => null)
    if (!rRes || !rRes.data) {
      return { ok: false, code: 'NOT_FOUND', message: '答卷不存在' }
    }
    const r = rRes.data
    if (r.openid !== OPENID) {
      return { ok: false, code: 'FORBIDDEN', message: '无权操作该答卷' }
    }
    if (r.status !== 'in_progress') {
      return { ok: false, code: 'NOT_IN_PROGRESS', message: '该答卷已不可编辑' }
    }
    const now = Date.now()
    if (now > new Date(r.deadline).getTime() + SAVE_GRACE_MS) {
      return { ok: false, code: 'EXPIRED', message: '答题时间已结束' }
    }

    const update = {
      answers,
      clientLastSavedAt: new Date(now)
    }
    if (switchInc > 0) {
      update.switchCount = _.inc(switchInc)
    }

    await db.collection('examEnrollments').doc(enrollmentId).update({ data: update })

    return {
      ok: true,
      clientLastSavedAt: now,
      switchCount: (r.switchCount || 0) + switchInc
    }
  } catch (err) {
    console.error('[saveDraft] error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
