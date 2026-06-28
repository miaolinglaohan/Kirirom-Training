// 一次性数据库初始化云函数
// 用途：在新环境中创建项目所需的 6 个集合，并写入最小可用的种子数据
// 调用方式：云开发控制台 → 云函数 → initDB → 测试 → 不传参直接调用
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// 需要创建的全部集合
const COLLECTIONS = ['exam', 'subjects', 'questions', 'historys', 'notes', 'profiles']

// 种子数据（来自项目 data 目录中的 exam.json / subjects.json / questions.json）
const SEED_EXAM = [
  { _id: '001', name: '微信测评' }
]

const SEED_SUBJECTS = [
  { _id: '001001', name: '微信测评一', pid: '001' }
]

const SEED_QUESTIONS = [
  {
    _id: '01', examid: '001001', typecode: '01',
    name: '微信的创始人是？',
    options: [
      { label: 'A', text: '马化腾', value: '0' },
      { label: 'B', text: '张小龙', value: '1' },
      { label: 'C', text: '马云',   value: '0' },
      { label: 'D', text: '李彦宏', value: '0' }
    ]
  },
  {
    _id: '02', examid: '001001', typecode: '01',
    name: '微信最早发布于哪一年？',
    options: [
      { label: 'A', text: '2009', value: '0' },
      { label: 'B', text: '2010', value: '0' },
      { label: 'C', text: '2011', value: '1' },
      { label: 'D', text: '2012', value: '0' }
    ]
  },
  {
    _id: '03', examid: '001001', typecode: '01',
    name: '微信小程序于哪一年正式上线？',
    options: [
      { label: 'A', text: '2015', value: '0' },
      { label: 'B', text: '2016', value: '0' },
      { label: 'C', text: '2017', value: '1' },
      { label: 'D', text: '2018', value: '0' }
    ]
  },
  {
    _id: '04', examid: '001001', typecode: '01',
    name: '微信支付的最大单笔限额（个人账户）通常是？',
    options: [
      { label: 'A', text: '1 千元', value: '0' },
      { label: 'B', text: '5 千元', value: '0' },
      { label: 'C', text: '2 万元', value: '1' },
      { label: 'D', text: '无限额', value: '0' }
    ]
  },
  {
    _id: '05', examid: '001001', typecode: '01',
    name: '下列哪个不是微信的功能？',
    options: [
      { label: 'A', text: '朋友圈', value: '0' },
      { label: 'B', text: '摇一摇', value: '0' },
      { label: 'C', text: '看一看', value: '0' },
      { label: 'D', text: '打车一键叫车（独立 App）', value: '1' }
    ]
  },
  {
    _id: '06', examid: '001001', typecode: '01',
    name: '微信公众号分为哪两类？',
    options: [
      { label: 'A', text: '订阅号 / 服务号', value: '1' },
      { label: 'B', text: '个人号 / 企业号', value: '0' },
      { label: 'C', text: '免费号 / 付费号', value: '0' },
      { label: 'D', text: '普通号 / 认证号', value: '0' }
    ]
  },
  {
    _id: '07', examid: '001001', typecode: '01',
    name: '微信小程序的开发语言主要是？',
    options: [
      { label: 'A', text: 'Java',       value: '0' },
      { label: 'B', text: 'Swift',      value: '0' },
      { label: 'C', text: 'JavaScript', value: '1' },
      { label: 'D', text: 'Python',     value: '0' }
    ]
  },
  {
    _id: '08', examid: '001001', typecode: '01',
    name: '微信红包最早出现在哪一年春节？',
    options: [
      { label: 'A', text: '2013', value: '0' },
      { label: 'B', text: '2014', value: '1' },
      { label: 'C', text: '2015', value: '0' },
      { label: 'D', text: '2016', value: '0' }
    ]
  },
  {
    _id: '09', examid: '001001', typecode: '01',
    name: '以下哪个不是微信支持的登录方式？',
    options: [
      { label: 'A', text: '手机号',  value: '0' },
      { label: 'B', text: '微信号',  value: '0' },
      { label: 'C', text: 'QQ 号',   value: '0' },
      { label: 'D', text: '邮箱地址（独立注册）', value: '1' }
    ]
  },
  {
    _id: '10', examid: '001001', typecode: '01',
    name: '微信小程序的页面文件后缀是？',
    options: [
      { label: 'A', text: '.html', value: '0' },
      { label: 'B', text: '.wxml', value: '1' },
      { label: 'C', text: '.xml',  value: '0' },
      { label: 'D', text: '.jsx',  value: '0' }
    ]
  }
]

// 尝试创建集合，已存在时忽略错误
async function ensureCollection (name) {
  try {
    await db.createCollection(name)
    return { name, created: true }
  } catch (e) {
    // -502005: database collection already exists
    if (e && (e.errCode === -502005 || /already exist/i.test(e.errMsg || ''))) {
      return { name, created: false, existed: true }
    }
    return { name, created: false, error: e.errMsg || String(e) }
  }
}

// 写入种子数据；用 _id 判断是否已存在，避免重复插入
async function seed (collection, records) {
  const result = { collection, inserted: 0, skipped: 0, failed: 0, errors: [] }
  for (const rec of records) {
    try {
      const exist = await db.collection(collection).doc(rec._id).get().catch(() => null)
      if (exist && exist.data) {
        result.skipped += 1
        continue
      }
      await db.collection(collection).add({ data: rec })
      result.inserted += 1
    } catch (e) {
      result.failed += 1
      result.errors.push({ id: rec._id, msg: e.errMsg || String(e) })
    }
  }
  return result
}

exports.main = async () => {
  const summary = {
    env: cloud.DYNAMIC_CURRENT_ENV,
    collections: [],
    seed: []
  }

  // 1) 创建 6 个集合
  for (const name of COLLECTIONS) {
    const r = await ensureCollection(name)
    summary.collections.push(r)
  }

  // 2) 写入种子数据（仅前 3 个集合）
  summary.seed.push(await seed('exam', SEED_EXAM))
  summary.seed.push(await seed('subjects', SEED_SUBJECTS))
  summary.seed.push(await seed('questions', SEED_QUESTIONS))

  return summary
}
