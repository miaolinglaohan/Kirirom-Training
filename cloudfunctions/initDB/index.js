// 一次性数据库初始化云函数
// 用途：在新环境中创建项目所需的 6 个集合，并写入最小可用的种子数据
// 调用方式：云开发控制台 → 云函数 → initDB → 测试 → 不传参直接调用
// 入参支持：{ "reseed": true } 时，会先删除现有种子记录再重新写入（用于修正字段错配）
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// 需要创建的全部集合
const COLLECTIONS = ['exam', 'subjects', 'questions', 'historys', 'notes', 'profiles']

// 种子数据（与前端 WXML/JS 期望的字段名严格一致）
// 字段约定参考：pages/exam/exam.wxml 与 data/questions.json
//   questions: { _id, title, typecode, typename, comments, options:[{value,code,content}], examid }
//   subjects:  { _id, name, pid }
//   exam:      { _id, name }
const SEED_EXAM = [
  { _id: '001', name: '微信测评' }
]

const SEED_SUBJECTS = [
  { _id: '001001', name: '微信测评一', pid: '001' }
]

const SEED_QUESTIONS = [
  {
    _id: '01', examid: '001001', typecode: '01', typename: '单选',
    title: '微信的创始人是？',
    comments: '微信由腾讯公司张小龙团队主导开发',
    options: [
      { code: 'A', content: '马化腾', value: '0' },
      { code: 'B', content: '张小龙', value: '1' },
      { code: 'C', content: '马云',   value: '0' },
      { code: 'D', content: '李彦宏', value: '0' }
    ]
  },
  {
    _id: '02', examid: '001001', typecode: '01', typename: '单选',
    title: '微信最早发布于哪一年？',
    comments: '微信于 2011 年 1 月 21 日由腾讯发布',
    options: [
      { code: 'A', content: '2009', value: '0' },
      { code: 'B', content: '2010', value: '0' },
      { code: 'C', content: '2011', value: '1' },
      { code: 'D', content: '2012', value: '0' }
    ]
  },
  {
    _id: '03', examid: '001001', typecode: '01', typename: '单选',
    title: '微信小程序于哪一年正式上线？',
    comments: '微信小程序于 2017 年 1 月 9 日正式上线',
    options: [
      { code: 'A', content: '2015', value: '0' },
      { code: 'B', content: '2016', value: '0' },
      { code: 'C', content: '2017', value: '1' },
      { code: 'D', content: '2018', value: '0' }
    ]
  },
  {
    _id: '04', examid: '001001', typecode: '01', typename: '单选',
    title: '微信支付的个人单笔支付限额通常是多少？',
    comments: '在已实名+绑卡前提下，单笔限额一般为 2 万元',
    options: [
      { code: 'A', content: '1 千元', value: '0' },
      { code: 'B', content: '5 千元', value: '0' },
      { code: 'C', content: '2 万元', value: '1' },
      { code: 'D', content: '无限额', value: '0' }
    ]
  },
  {
    _id: '05', examid: '001001', typecode: '01', typename: '单选',
    title: '下列哪一个不是微信内置的功能？',
    comments: '微信内置朋友圈/摇一摇/看一看，独立打车 App 非微信功能',
    options: [
      { code: 'A', content: '朋友圈', value: '0' },
      { code: 'B', content: '摇一摇', value: '0' },
      { code: 'C', content: '看一看', value: '0' },
      { code: 'D', content: '独立打车 App', value: '1' }
    ]
  },
  {
    _id: '06', examid: '001001', typecode: '01', typename: '单选',
    title: '微信公众号分为哪两类？',
    comments: '公众号目前主要分为订阅号和服务号两类',
    options: [
      { code: 'A', content: '订阅号 / 服务号', value: '1' },
      { code: 'B', content: '个人号 / 企业号', value: '0' },
      { code: 'C', content: '免费号 / 付费号', value: '0' },
      { code: 'D', content: '普通号 / 认证号', value: '0' }
    ]
  },
  {
    _id: '07', examid: '001001', typecode: '01', typename: '单选',
    title: '微信小程序的开发语言主要是？',
    comments: '小程序逻辑层使用 JavaScript',
    options: [
      { code: 'A', content: 'Java',       value: '0' },
      { code: 'B', content: 'Swift',      value: '0' },
      { code: 'C', content: 'JavaScript', value: '1' },
      { code: 'D', content: 'Python',     value: '0' }
    ]
  },
  {
    _id: '08', examid: '001001', typecode: '01', typename: '单选',
    title: '微信红包最早出现在哪一年的春节？',
    comments: '微信红包于 2014 年春节大规模上线',
    options: [
      { code: 'A', content: '2013', value: '0' },
      { code: 'B', content: '2014', value: '1' },
      { code: 'C', content: '2015', value: '0' },
      { code: 'D', content: '2016', value: '0' }
    ]
  },
  {
    _id: '09', examid: '001001', typecode: '01', typename: '单选',
    title: '以下哪个不是微信支持的登录方式？',
    comments: '微信支持手机号、微信号、QQ 号登录，邮箱登录不支持',
    options: [
      { code: 'A', content: '手机号',     value: '0' },
      { code: 'B', content: '微信号',     value: '0' },
      { code: 'C', content: 'QQ 号',      value: '0' },
      { code: 'D', content: '邮箱地址',   value: '1' }
    ]
  },
  {
    _id: '10', examid: '001001', typecode: '01', typename: '单选',
    title: '微信小程序的页面结构文件后缀是？',
    comments: '小程序使用 .wxml 作为页面结构（类 HTML）',
    options: [
      { code: 'A', content: '.html', value: '0' },
      { code: 'B', content: '.wxml', value: '1' },
      { code: 'C', content: '.xml',  value: '0' },
      { code: 'D', content: '.jsx',  value: '0' }
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

// 写入种子数据
// reseed=false：仅在记录不存在时插入；reseed=true：先删再插，用于修正字段错配
async function seed (collection, records, reseed) {
  const result = { collection, inserted: 0, replaced: 0, skipped: 0, failed: 0, errors: [] }
  for (const rec of records) {
    try {
      const exist = await db.collection(collection).doc(rec._id).get().catch(() => null)
      const hasIt = !!(exist && exist.data)

      if (hasIt && !reseed) {
        result.skipped += 1
        continue
      }

      if (hasIt && reseed) {
        await db.collection(collection).doc(rec._id).remove()
        await db.collection(collection).add({ data: rec })
        result.replaced += 1
      } else {
        await db.collection(collection).add({ data: rec })
        result.inserted += 1
      }
    } catch (e) {
      result.failed += 1
      result.errors.push({ id: rec._id, msg: e.errMsg || String(e) })
    }
  }
  return result
}

exports.main = async (event) => {
  const reseed = !!(event && event.reseed)

  const summary = {
    env: cloud.DYNAMIC_CURRENT_ENV,
    reseed,
    collections: [],
    seed: []
  }

  // 1) 创建 6 个集合
  for (const name of COLLECTIONS) {
    const r = await ensureCollection(name)
    summary.collections.push(r)
  }

  // 2) 写入/重置种子数据
  summary.seed.push(await seed('exam', SEED_EXAM, reseed))
  summary.seed.push(await seed('subjects', SEED_SUBJECTS, reseed))
  summary.seed.push(await seed('questions', SEED_QUESTIONS, reseed))

  return summary
}
