// miniprogram/pages/review/review.js
//
// 复盘页（培训系统版）：
//   - 直接读取 historys 集合中的快照渲染，不再二次查询 question 集合
//   - 展示：题干 + 选项 + 用户作答 + 正确答案 + 对错 + 解析（如有）
//   - 设计前提：内部培训用，复盘允许公开标准答案，便于员工复习巩固
//
// 选项配色规则：
//   - 既是用户选 又是正确  → 绿色高亮（answered-right）
//   - 是用户选 但错        → 红色高亮（answered-wrong）
//   - 用户没选 但是正确    → 绿色虚框（official-only）
//   - 其他                 → 普通灰白

const app = getApp()

Page({
  data: {
    loading: true,
    title: '',
    createTime: '',
    rightNum: 0,
    total: 0,
    idx: 0,
    percent: 0,
    item: null,            // 当前题目快照
    optionLines: [],       // [{code, content, isUser, isOfficial, state}]
    userText: '-',
    officialText: '-',
    right: false,
    isLast: false,
    onlyWrong: false       // 由 mistakes 页跳过来时筛选模式
  },

  onLoad(options) {
    const id = options && options.id ? String(options.id) : ''
    const onlyWrong = !!(options && options.onlyWrong === '1')
    const startIdx = options && options.idx != null ? Number(options.idx) : 0
    if (!id) {
      wx.showToast({ icon: 'none', title: '缺少记录 ID' })
      return
    }
    this.setData({ onlyWrong })
    this._startIdx = isNaN(startIdx) ? 0 : startIdx
    this.loadHistory(id)
  },

  loadHistory(id) {
    const db = wx.cloud.database()
    db.collection('historys').doc(id).get().then(res => {
      const h = res.data || {}
      const rawItems = Array.isArray(h.items) ? h.items : []
      // 兼容：极老历史可能 items 是字符串数组（_id），无法渲染
      const items = rawItems.filter(x => x && typeof x === 'object' && x.title)
      if (items.length === 0) {
        this.setData({
          loading: false,
          legacy: true,
          title: (h.subject && h.subject.name) || '历史记录'
        })
        return
      }
      const total = items.length
      const subjectName = h.displayName || h.assessmentName || (h.subject && h.subject.name) || '考试'
      // 构造 qid → correctCodes 映射
      const officialMap = {}
      ;(h.answersOfficial || []).forEach(a => {
        const codes = (a.correctCodes || []).map(c => String(c).toUpperCase())
        officialMap[a.qid] = codes
      })
      this.setData({
        loading: false,
        items,
        userAnswers: h.userAnswers || {},
        scoreArr: Array.isArray(h.score_arr) ? h.score_arr : [],
        officialMap,
        title: subjectName,
        createTime: h.createTime || '',
        rightNum: h.rightNum || 0,
        // Phase 3：优先用分数维度，旧考卷回退 rightNum/total
        score: typeof h.score === 'number' ? h.score : (h.rightNum || 0),
        fullScore: typeof h.fullScore === 'number' && h.fullScore > 0 ? h.fullScore : total,
        isPointScored: typeof h.fullScore === 'number' && h.fullScore > 0 && h.fullScore !== total,
        total
      }, () => {
        let startIdx = this._startIdx || 0
        if (startIdx < 0 || startIdx >= total) startIdx = 0
        this.renderIdx(startIdx)
      })
    }).catch(err => {
      console.error('[review] 查询 historys 失败', err)
      wx.showToast({ icon: 'none', title: '加载失败' })
      this.setData({ loading: false })
    })
  },

  // 渲染第 idx 题
  renderIdx(idx) {
    const items = this.data.items || []
    if (idx < 0 || idx >= items.length) return
    const q = items[idx]

    const userAns = (this.data.userAnswers && this.data.userAnswers[q._id]) || []
    const userSet = {}
    ;(Array.isArray(userAns) ? userAns : [userAns]).forEach(c => {
      if (c) userSet[String(c).toUpperCase()] = true
    })

    const officialCodes = (this.data.officialMap && this.data.officialMap[q._id]) || []
    const officialSet = {}
    officialCodes.forEach(c => { officialSet[String(c).toUpperCase()] = true })

    const optionLines = (q.options || []).map(opt => {
      const code = String(opt.code).toUpperCase()
      const isUser = !!userSet[code]
      const isOfficial = !!officialSet[code]
      let state = 'plain'
      if (isUser && isOfficial) state = 'answered-right'
      else if (isUser && !isOfficial) state = 'answered-wrong'
      else if (!isUser && isOfficial) state = 'official-only'
      return {
        code: opt.code,
        content: opt.content,
        isUser,
        isOfficial,
        state
      }
    })

    const userKeys = Object.keys(userSet).sort()
    const officialKeys = officialCodes.slice().sort()
    const right = !!(this.data.scoreArr && this.data.scoreArr[idx])
    const total = this.data.total || items.length

    this.setData({
      idx,
      item: q,
      isJudge: String(q.typecode || '01') === '03',
      optionLines,
      userText: userKeys.length ? userKeys.join('、') : '未作答',
      officialText: officialKeys.length ? officialKeys.join('、') : '-',
      right,
      isLast: idx === items.length - 1,
      percent: total ? Math.round(((idx + 1) / total) * 100) : 0
    })
  },

  goPrev() {
    if (this.data.idx > 0) this.renderIdx(this.data.idx - 1)
  },

  goNext() {
    const items = this.data.items || []
    if (this.data.idx < items.length - 1) {
      this.renderIdx(this.data.idx + 1)
    } else {
      this.goBack()
    }
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  }
})
