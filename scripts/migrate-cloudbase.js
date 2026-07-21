// scripts/migrate-cloudbase.js
//
// 一次性迁移脚本：把【旧云开发环境】的 9 个集合数据，搬到【新云开发环境】。
//
// 原理：用腾讯云侧身份（secretId / secretKey）通过 @cloudbase/manager
//       直接读写云开发数据库，不依赖微信登录态。
//       读旧环境 -> 在新环境建集合 -> 批量灌数据。
//
// 使用方法见同目录 README.md。

const cloudbase = require('@cloudbase/manager')

// ============== ① 请修改这 4 个值 ==============
// 旧环境（数据来源）
const SRC_ENV_ID = 'cloud1-xxxxxxxxxxxxxxx'
// 新环境（数据去向）
const DST_ENV_ID = 'cloud1-yyyyyyyyyyyyyyy'
// 腾讯云访问密钥（去腾讯云控制台 CAM 拿，见 README）
const SECRET_ID = 'AKIDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
const SECRET_KEY = 'yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'
// =============================================

// 要迁移的 9 个集合（名字必须和旧环境一致）
const COLLECTIONS = [
  'exam',
  'subjects',
  'questions',
  'historys',
  'notes',
  'profiles',
  'employees',
  'assessments',
  'examEnrollments',
  'sysConfig'
]

// 每批读取/写入的条数（云开发单次 limit 上限 1000）
const BATCH_SIZE = 1000
// 每条记录写入后的小延时，避免触发限流
const SLEEP_MS = 20

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  console.log('=== 云开发数据库迁移脚本 ===')
  console.log('源环境：', SRC_ENV_ID)
  console.log('目标环境：', DST_ENV_ID)
  console.log('集合数：', COLLECTIONS.length)
  console.log('')

  // 校验配置
  if (SRC_ENV_ID.startsWith('cloud1-xxx') || DST_ENV_ID.startsWith('cloud1-yyy') ||
      SECRET_ID.startsWith('AKIDxxx') || SECRET_KEY.startsWith('yyy')) {
    console.error('✗ 请先修改脚本顶部的 4 个配置项（SRC_ENV_ID / DST_ENV_ID / SECRET_ID / SECRET_KEY）')
    process.exit(1)
  }
  if (SRC_ENV_ID === DST_ENV_ID) {
    console.error('✗ 源环境和目标环境不能相同')
    process.exit(1)
  }

  // 用腾讯云密钥初始化两个环境的 manager 实例
  const srcApp = cloudbase.init({
    envId: SRC_ENV_ID,
    secretId: SECRET_ID,
    secretKey: SECRET_KEY
  })
  const dstApp = cloudbase.init({
    envId: DST_ENV_ID,
    secretId: SECRET_ID,
    secretKey: SECRET_KEY
  })
  const srcDb = srcApp.database()
  const dstDb = dstApp.database()

  let totalCopied = 0
  let totalSkipped = 0

  for (const coll of COLLECTIONS) {
    console.log(`\n--- 处理集合：${coll} ---`)
    let offset = 0
    let collCount = 0

    // ① 在新环境建集合（已存在则跳过，不报错）
    try {
      await dstDb.createCollection(coll)
      console.log(`  ✓ 已在新环境创建集合 ${coll}`)
    } catch (e) {
      // 集合已存在会报错，忽略即可
      console.log(`  · 集合 ${coll} 已存在或创建失败（${e.message || e}），继续灌数据`)
    }

    // ② 分批读旧环境数据
    while (true) {
      let res
      try {
        res = await srcDb.collection(coll).limit(BATCH_SIZE).skip(offset).get()
      } catch (e) {
        console.error(`  ✗ 读取 ${coll} (offset=${offset}) 失败：${e.message || e}`)
        // 源集合不存在就跳过
        if (String(e).indexOf('DATABASE_COLLECTION_NOT_EXIST') >= 0 || /not exist/i.test(String(e))) {
          console.log(`  · 源环境无 ${coll} 集合，跳过`)
          break
        }
        // 其他错误也跳过，避免卡死整个迁移
        break
      }
      const records = res.data || []
      if (records.length === 0) break

      // ③ 批量写入新环境
      // 注意：写入时不带 _id，让新环境自动生成，避免 _id 冲突
      //       _openid 字段保留原值（迁移后可能对不上人，见 README 说明）
      const cleanRecords = records.map(r => {
        const c = Object.assign({}, r)
        delete c._id
        return c
      })

      try {
        // batchInsert 是 manager SDK 的批量插入，一次最多 1000 条
        await dstDb.collection(coll).add(cleanRecords)
        collCount += records.length
        console.log(`  · 已写入 ${collCount} 条（本批 ${records.length}）`)
      } catch (e) {
        console.error(`  ✗ 写入 ${coll} 失败：${e.message || e}`)
        totalSkipped += records.length
        break
      }

      offset += records.length
      if (records.length < BATCH_SIZE) break  // 读完了
      await sleep(SLEEP_MS)
    }

    console.log(`  → ${coll} 完成，共 ${collCount} 条`)
    totalCopied += collCount
  }

  console.log('\n=== 迁移完成 ===')
  console.log(`总写入：${totalCopied} 条`)
  if (totalSkipped > 0) {
    console.log(`总跳过：${totalSkipped} 条（写入失败的批次）`)
  }
  console.log('\n⚠ 后续必做：')
  console.log('  1. 改 miniprogram/app.js 第 23 行 env 为新环境 ID')
  console.log('  2. 上传部署全部云函数（右键 cloudfunctions 各目录 -> 上传并部署）')
  console.log('  3. 在新环境数据库把【你自己的 employees 记录】role 改成 admin')
  console.log('  4. 调整各集合权限规则（见 docs/部署运维清单.md）')
}

main().catch(err => {
  console.error('\n✗ 迁移脚本异常退出：', err)
  process.exit(1)
})
