// cloudfunctions/hrSaveSubject/index.js
//
// 用途：HR 新建或更新题库（subjects 集合）。
//
// 入参：
//   { _id: string, name: string, pid: string, isCreate?: boolean }
//   - _id 是手填字符串（如 "001002"）
//   - 新建模式（isCreate=true）：校验 _id 唯一 + pid 存在于 exam
//   - 更新模式（isCreate=false / 默认）：按 _id 查到再更新，不允许改 _id
//
// 返回：{ ok, _id, mode } 或 { ok:false, code, message }

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

  const _id = String(event._id || '').trim()
  const name = String(event.name || '').trim()
  const pid = String(event.pid || '').trim()
  const isCreate = !!event.isCreate

  if (!_id) return { ok: false, code: 'MISSING_ID', message: '题库编号必填' }
  if (!name) return { ok: false, code: 'MISSING_NAME', message: '题库名称必填' }
  if (!pid) return { ok: false, code: 'MISSING_PID', message: '请选择所属一级试卷' }
  if (!/^[A-Za-z0-9_-]+$/.test(_id)) {
    return { ok: false, code: 'INVALID_ID', message: '题库编号只能用字母/数字/下划线/连字符' }
  }

  // pid 存在性校验
  try {
    const er = await db.collection('exam').where({ _id: pid }).limit(1).get()
    if (!er.data || er.data.length === 0) {
      return { ok: false, code: 'PID_NOT_FOUND', message: '所属一级试卷不存在' }
    }
  } catch (err) {
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }

  if (isCreate) {
    // 新建：先检查 _id 是否已存在
    try {
      const exist = await db.collection('subjects').where({ _id }).limit(1).get()
      if (exist.data && exist.data.length > 0) {
        return { ok: false, code: 'ID_EXISTS', message: '题库编号已存在' }
      }
      await db.collection('subjects').add({ data: { _id, name, pid } })
      return { ok: true, _id, mode: 'create' }
    } catch (err) {
      console.error('[hrSaveSubject] create error', err)
      return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
    }
  } else {
    // 更新
    try {
      const exist = await db.collection('subjects').where({ _id }).limit(1).get()
      if (!exist.data || exist.data.length === 0) {
        return { ok: false, code: 'NOT_FOUND', message: '要更新的题库不存在' }
      }
      await db.collection('subjects').doc(_id).update({ data: { name, pid } })
      return { ok: true, _id, mode: 'update' }
    } catch (err) {
      console.error('[hrSaveSubject] update error', err)
      return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
    }
  }
}
