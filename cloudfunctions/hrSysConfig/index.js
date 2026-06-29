// cloudfunctions/hrSysConfig/index.js
//
// 用途：系统级配置项的读写。
//
// 入参：{ action: 'get'|'set', key: string, value?: string }
//
// 权限：
//   - get：所有已激活员工皆可（PDF 水印不是密钥，导出按钮需要 HR/admin/普通员工触发都能读）
//   - set：仅 admin（HR 也不行）
//
// 数据：sysConfig 集合，文档 _id 即 key，例如：
//   { _id: 'pdfWatermark', value: '基里隆项目部内部资料 · 严禁外传', updatedAt: <Date>, updatedBy: <openid> }
//
// 当前支持的 key 白名单（防止脏写）：
//   - 'pdfWatermark'（≤60 字符）
//
// 返回：
//   get: { ok: true, value }（不存在时 value 为空字符串）
//   set: { ok: true, _id }
//   { ok: false, code, message }

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const ALLOWED_KEYS = {
  pdfWatermark: { maxLength: 60 },
  unitName:     { maxLength: 40 }   // 单位名称：会印在 PDF 总分单右下角
}

async function requireActive(OPENID) {
  if (!OPENID) return { err: { ok: false, code: 'NO_OPENID', message: '无法获取微信身份' } }
  const r = await db.collection('employees').where({ openid: OPENID }).limit(1).get()
  const me = r.data[0]
  if (!me || me.active === false) {
    return { err: { ok: false, code: 'FORBIDDEN', message: '未激活或已停用' } }
  }
  return { me }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const g = await requireActive(OPENID)
  if (g.err) return g.err
  const me = g.me

  const action = String((event && event.action) || '').trim()
  const key = String((event && event.key) || '').trim()

  if (!ALLOWED_KEYS[key]) {
    return { ok: false, code: 'INVALID_KEY', message: '不支持的配置项' }
  }

  if (action === 'get') {
    try {
      const r = await db.collection('sysConfig').doc(key).get().catch(() => null)
      const value = (r && r.data && typeof r.data.value === 'string') ? r.data.value : ''
      return { ok: true, value }
    } catch (err) {
      console.error('[hrSysConfig.get] error', err)
      return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
    }
  }

  if (action === 'set') {
    if (me.role !== 'admin') {
      return { ok: false, code: 'FORBIDDEN_SET', message: '仅 admin 可修改系统设置' }
    }
    const raw = event && typeof event.value === 'string' ? event.value : ''
    const value = raw.trim()
    const limit = ALLOWED_KEYS[key].maxLength
    if (value.length > limit) {
      return { ok: false, code: 'TOO_LONG', message: `内容超出 ${limit} 字符限制` }
    }
    try {
      // upsert：先尝试 get，存在则 update，不存在则 add
      const existing = await db.collection('sysConfig').doc(key).get().catch(() => null)
      const payload = {
        value,
        updatedAt: new Date(),
        updatedBy: OPENID
      }
      if (existing && existing.data) {
        await db.collection('sysConfig').doc(key).update({ data: payload })
      } else {
        await db.collection('sysConfig').add({ data: Object.assign({ _id: key }, payload) })
      }
      return { ok: true, _id: key }
    } catch (err) {
      console.error('[hrSysConfig.set] error', err)
      const msg = (err && (err.errMsg || err.message)) || String(err)
      // 集合不存在 → 友好提示（云函数没法自动建集合，必须管理员手工建）
      if (/-?502005/.test(msg) || /collection not exist/i.test(msg) || /DATABASE_COLLECTION_NOT_EXIST/i.test(msg)) {
        return {
          ok: false,
          code: 'COLLECTION_NOT_EXIST',
          message: '数据库集合 sysConfig 不存在，请到云开发控制台 → 数据库 → 新建集合 sysConfig（空集合即可）后再保存。'
        }
      }
      return { ok: false, code: 'DB_ERROR', message: msg }
    }
  }

  return { ok: false, code: 'INVALID_ACTION', message: 'action 必须是 get 或 set' }
}
