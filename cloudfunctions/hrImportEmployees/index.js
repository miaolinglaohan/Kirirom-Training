// cloudfunctions/hrImportEmployees/index.js
//
// 用途：HR 批量导入员工白名单。
//
// 入参：{ csv: string }  —— CSV 文本（UTF-8，可含 BOM）
//   列：姓名, 部门, role, active, 备注
//   备注 列可选，其余必填
//
// 返回：{ ok, inserted, skipped, errors: [{ row, msg }] }
//
// 重复策略：姓名+部门相同 → 跳过（skipped），不覆盖已有记录

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const VALID_DEPTS = ['项目部', '运行检修部', '综合管理部', '枢纽管理部', '安全技术部', '财务资金部']
const VALID_ROLES = ['employee', 'hr', 'admin']

async function requireHr(OPENID) {
  if (!OPENID) return { err: { ok: false, code: 'NO_OPENID', message: '无法获取微信身份' } }
  const r = await db.collection('employees').where({ openid: OPENID }).limit(1).get()
  const me = r.data[0]
  if (!me || me.active === false || (me.role !== 'hr' && me.role !== 'admin')) {
    return { err: { ok: false, code: 'FORBIDDEN', message: '没有 HR 权限' } }
  }
  return { me }
}

// 简易 CSV 解析器：支持引号包裹（含逗号、换行）和转义双引号
function parseCSV(text) {
  // 去掉 BOM
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
  // 最后一行
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const g = await requireHr(OPENID)
  if (g.err) return g.err

  const csv = String(event.csv || '')
  if (!csv.trim()) {
    return { ok: false, code: 'EMPTY_CSV', message: 'CSV 内容为空' }
  }

  try {
    const rows = parseCSV(csv)
    if (rows.length < 2) {
      return { ok: false, code: 'NO_DATA', message: 'CSV 没有数据行（只有表头或为空）' }
    }

    // 表头校验（至少要有 姓名 和 部门）
    const header = rows[0].map(h => h.trim())
    const nameIdx = header.findIndex(h => h === '姓名' || h.toLowerCase() === 'name')
    const deptIdx = header.findIndex(h => h === '部门' || h.toLowerCase() === 'dept')
    const roleIdx = header.findIndex(h => h === 'role' || h.toLowerCase() === 'role')
    const activeIdx = header.findIndex(h => h === 'active' || h.toLowerCase() === 'active')

    if (nameIdx < 0 || deptIdx < 0) {
      return { ok: false, code: 'BAD_HEADER', message: 'CSV 表头缺少"姓名"或"部门"列' }
    }

    // 预查全部已有员工，建 (name+dept) → true 的索引，避免逐条查库
    const existingRes = await db.collection('employees')
      .field({ name: true, dept: true })
      .limit(1000)
      .get()
    const existingMap = {}
    ;(existingRes.data || []).forEach(e => {
      existingMap[(e.name || '') + '|' + (e.dept || '')] = true
    })

    let inserted = 0
    let skipped = 0
    const errors = []

    // 逐行处理
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]
      // 空行跳过
      if (row.length === 1 && !row[0].trim()) continue

      const name = (row[nameIdx] || '').trim()
      const dept = (row[deptIdx] || '').trim()

      // 校验
      if (!name) { errors.push({ row: r + 1, msg: '姓名为空' }); continue }
      if (!dept) { errors.push({ row: r + 1, msg: '部门为空' }); continue }
      if (VALID_DEPTS.indexOf(dept) < 0) {
        errors.push({ row: r + 1, msg: `部门"${dept}"不在有效枚举内` }); continue
      }

      const role = roleIdx >= 0 ? (row[roleIdx] || '').trim() : 'employee'
      if (role && VALID_ROLES.indexOf(role) < 0) {
        errors.push({ row: r + 1, msg: `role"${role}"无效（应为 employee/hr/admin）` }); continue
      }

      const activeStr = activeIdx >= 0 ? (row[activeIdx] || '').trim().toLowerCase() : 'true'
      const active = activeStr !== 'false' && activeStr !== '0'

      // 重复检查
      const key = name + '|' + dept
      if (existingMap[key]) {
        skipped++
        continue
      }

      // 写入
      try {
        await db.collection('employees').add({
          data: {
            name,
            dept,
            role: role || 'employee',
            active,
            // openid / activatedAt 不填，等员工自行激活时写入
          }
        })
        existingMap[key] = true  // 防止同批次内重复
        inserted++
      } catch (err) {
        errors.push({ row: r + 1, msg: `写入失败: ${err.errMsg || String(err)}` })
      }
    }

    return { ok: true, inserted, skipped, errors }
  } catch (err) {
    console.error('[hrImportEmployees] error', err)
    return { ok: false, code: 'DB_ERROR', message: err.errMsg || String(err) }
  }
}
