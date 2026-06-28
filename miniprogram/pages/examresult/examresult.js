// pages/examresult/examresult.js
//
// Phase 2 重写：服务端判分后的结果展示。
//
// 数据来源：
//   1) URL query 兜底（length / rightNum / errNum / ordernum / isMock）
//   2) app.globalData.lastExamResult（exam.js 在跳转前写入，包含详细 perQuestion / answersOfficial）
//      仅模考会带 answersOfficial，正式考不下发以防作弊截图传播。
//
// UI：
//   - 顶部分数环（rightNum / total）
//   - 卡片：查看错题（跳回 note 页，保持兼容）
//   - 模考独有：题目逐题复盘（用户答案 vs 正确答案，对错标记）
//   - 底部：返回首页

const app = getApp()

Page({
  data: {
    isMock: false,
    total: 0,
    rightNum: 0,
    errNum: 0,
    unAnswerNum: 0,
    score: 0,                 // Phase 3: 实得分数
    fullScore: 0,             // Phase 3: 满分
    scoreText: '0',           // 显示用：分数文案，未来可换算百分制
    accuracyText: '0%',
    isPointScored: false,     // 分数 ≠ 题数（启用 1 分以外的题分）
    ordernum: '',

    // 模考复盘
    reviewList: [],           // [{ idx, qtitle, qtype, optionLines:[{code,content,isUser,isOfficial}], userText, officialText, right }]
    showReview: false         // 展开/收起
  },

  onLoad(e) {
    const fromGlobal = (app.globalData && app.globalData.lastExamResult) || null
    const isMock = e.isMock === '1' || (fromGlobal && fromGlobal.isMock)
    const total = Number(e.length) || (fromGlobal && fromGlobal.total) || 0
    const rightNum = Number(e.rightNum) || (fromGlobal && fromGlobal.rightNum) || 0
    const errNum = Math.max(0, total - rightNum)

    // Phase 3：优先使用分数维度；旧考卷 fromGlobal 无 fullScore 时回退到题数
    const score = fromGlobal && typeof fromGlobal.score === 'number' ? fromGlobal.score : rightNum
    const fullScore = fromGlobal && typeof fromGlobal.fullScore === 'number' && fromGlobal.fullScore > 0
      ? fromGlobal.fullScore
      : total
    const isPointScored = fullScore > 0 && fullScore !== total
    const accuracy = fullScore > 0 ? Math.round((score / fullScore) * 100) : 0

    this.setData({
      isMock: !!isMock,
      total,
      rightNum,
      errNum,
      unAnswerNum: 0,
      score,
      fullScore,
      isPointScored,
      ordernum: e.ordernum || (fromGlobal && fromGlobal.enrollmentId) || '',
      scoreText: String(score),
      accuracyText: accuracy + '%'
    })

    // 模考复盘
    if (isMock && fromGlobal && fromGlobal.answersOfficial && fromGlobal.questions) {
      this.setData({ reviewList: this.buildReview(fromGlobal) })
    }

    // 用完即焚：清掉 globalData，避免下次 onLoad 误用上次结果
    if (app.globalData) app.globalData.lastExamResult = null
  },

  buildReview(payload) {
    const questions = payload.questions || []
    const userAnswers = payload.userAnswers || {}
    const officialMap = {}
    ;(payload.answersOfficial || []).forEach(a => {
      officialMap[a.qid] = (a.correctCodes || []).slice().sort()
    })
    const perQMap = {}
    ;(payload.perQuestion || []).forEach(p => {
      perQMap[p.qid] = p
    })

    return questions.map((q, idx) => {
      const userCodes = Array.isArray(userAnswers[q._id]) ? userAnswers[q._id].slice().sort() : []
      const officialCodes = officialMap[q._id] || []
      const right = !!(perQMap[q._id] && perQMap[q._id].right)
      const optionLines = (q.options || []).map(opt => ({
        code: opt.code,
        content: opt.content,
        isUser: userCodes.indexOf(opt.code) >= 0,
        isOfficial: officialCodes.indexOf(opt.code) >= 0
      }))
      return {
        idx: idx + 1,
        qid: q._id,
        qtitle: q.title,
        qtype: q.typename || '',
        optionLines,
        userText: userCodes.length > 0 ? userCodes.join('') : '未作答',
        officialText: officialCodes.join(''),
        right
      }
    })
  },

  toggleReview() {
    this.setData({ showReview: !this.data.showReview })
  },

  examBack() {
    // 兼容老逻辑：跳到 note 页看错题（如果有）
    wx.redirectTo({ url: '/pages/note/note?ordernum=' + this.data.ordernum })
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/index' })
  },

  goHistory() {
    wx.switchTab({ url: '/pages/history/index' })
  }
})
