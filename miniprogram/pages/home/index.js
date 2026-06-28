// pages/home/index.js
const app = getApp()

Page({
  data: {
    openid: '',
    queryResult: [],

    // 统计条数据（Phase 0 占位，Phase 2 后接入真实数据）
    stats: {
      answered: 0,
      accuracy: 0
    },

    // 当前考试通知卡片
    // status: pending(未开考) | ongoing(进行中) | submitted(已交卷) | expired(已截止)
    // Phase 0 占位，Phase 3 接入真实数据
    currentExam: null
  },

  onLoad() {
    // 真正的初始化由 onShow 触发（先过身份守卫）
  },

  onShow() {
    app.guardAuth().then(emp => {
      if (!emp) return  // 未激活/已停用：已被 reLaunch 走
      this.setData({ openid: app.globalData.openid || '' })
      this.loadExamList()
      this.loadStats()
      this.loadCurrentExam()
    })
  },

  // —— 数据加载 ——
  loadExamList() {
    wx.cloud.database().collection('exam').get({
      success: res => {
        this.setData({ queryResult: res.data })
      },
      fail: err => {
        console.error('[home] exam 查询失败：', err)
      }
    })
  },

  loadStats() {
    // Phase 0 占位实现：从 historys 集合数一下
    // Phase 2 改为正经的 stats 云函数
    const db = wx.cloud.database()
    db.collection('historys').count({
      success: res => {
        this.setData({ 'stats.answered': res.total || 0 })
      },
      fail: () => {}
    })
    // accuracy 暂时保持 0，等正经统计逻辑接入
  },

  loadCurrentExam() {
    // Phase 3 才真正实现；Phase 0 先不显示考试卡片
    this.setData({ currentExam: null })
  },

  // —— 入口跳转 ——
  goExamList() {
    // 顺序练习：跳到第一个 exam 的 subjects 列表，没有则提示
    if (this.data.queryResult.length === 0) {
      wx.showToast({ icon: 'none', title: '暂无可练习题库' })
      return
    }
    const first = this.data.queryResult[0]
    wx.navigateTo({ url: '/pages/subject/index?id=' + first._id })
  },

  goRandom() {
    if (this.data.queryResult.length === 0) {
      wx.showToast({ icon: 'none', title: '暂无可练习题库' })
      return
    }
    // 随机刷题 = 走 simple 页（已有逻辑）
    const first = this.data.queryResult[0]
    wx.navigateTo({ url: '/pages/simple/index?id=' + first._id })
  },

  goNote() {
    wx.navigateTo({ url: '/pages/note/note' })
  },

  goReview() {
    wx.navigateTo({ url: '/pages/review/review' })
  },

  goHistory() {
    wx.switchTab({ url: '/pages/history/index' })
  },

  goProfile() {
    wx.switchTab({ url: '/pages/profile/index' })
  },

  // —— 大按钮：模拟考试 ——
  goMockExam() {
    // Phase 0：先复用现有 simple 页（随机刷题）作为模考入口，不写历史
    // Phase 2 后改为正式的模考流程（独立云函数 + 不写 historys）
    if (this.data.queryResult.length === 0) {
      wx.showToast({ icon: 'none', title: '暂无可用题库' })
      return
    }
    const first = this.data.queryResult[0]
    wx.navigateTo({ url: '/pages/simple/index?id=' + first._id + '&mode=mock' })
  },

  // —— 大按钮：考试安排 ——
  goExamSchedule() {
    wx.navigateTo({ url: '/pages/examSchedule/index' })
  },

  // —— 考试卡片点击 ——
  onTapExamCard() {
    // Phase 3 实现：根据状态决定跳候考页/考试页/成绩页
    wx.showToast({ icon: 'none', title: '考试功能待 Phase 2/3 实现' })
  },

  // —— 题库分类跳转（原有逻辑保留）——
  toSubjectsPage(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/subject/index?id=' + id })
  },

  onShareAppMessage() {
    return {
      title: '基里隆项目部业务培训考试',
      path: '/pages/home/index'
    }
  }
})
