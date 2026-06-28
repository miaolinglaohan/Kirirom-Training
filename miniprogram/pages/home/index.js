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
    // 调云函数取「进行中 / 即将开始」的考试，挑第一条展示
    wx.cloud.callFunction({
      name: 'listMyAssessments',
      data: { onlyActive: true }
    }).then(res => {
      const r = res.result || {}
      if (!r.ok || !r.list || r.list.length === 0) {
        this.setData({ currentExam: null })
        return
      }
      // 优先展示「进行中」，否则展示最近的「未开考」
      const ongoing = r.list.find(x => x.status === 'ongoing')
      const pending = r.list.find(x => x.status === 'pending')
      const pick = ongoing || pending
      if (!pick) {
        this.setData({ currentExam: null })
        return
      }
      const start = pick.startMs
      const startD = new Date(start)
      const pad = n => (n < 10 ? '0' + n : '' + n)
      const timeText = `${startD.getFullYear()}-${pad(startD.getMonth() + 1)}-${pad(startD.getDate())} ${pad(startD.getHours())}:${pad(startD.getMinutes())}`
      this.setData({
        currentExam: {
          _id: pick._id,
          name: pick.name,
          timeText,
          status: pick.status,
          statusText: pick.status === 'ongoing' ? '进行中' : '未开考',
          actionText: pick.status === 'ongoing' ? '立即进入考场' : '查看详情'
        }
      })
    }).catch(err => {
      console.error('[home] listMyAssessments 失败', err)
      this.setData({ currentExam: null })
    })
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
    wx.navigateTo({ url: '/pages/mistakes/index' })
  },

  goHistory() {
    wx.switchTab({ url: '/pages/history/index' })
  },

  goProfile() {
    wx.switchTab({ url: '/pages/profile/index' })
  },

  // —— 大按钮：模拟考试 ——
  goMockExam() {
    // 直接走真正的模考流程（云函数 enterExam，isMock=true，写 examEnrollments 不写 historys）
    if (this.data.queryResult.length === 0) {
      wx.showToast({ icon: 'none', title: '暂无可用题库' })
      return
    }
    // 题库只有一个就直接进；多个走选择页
    if (this.data.queryResult.length === 1) {
      const first = this.data.queryResult[0]
      wx.navigateTo({
        url: '/pages/exam/exam?mock=1&subjectId=' + encodeURIComponent(first._id)
      })
      return
    }
    // 多题库：让用户先选一个
    wx.showActionSheet({
      itemList: this.data.queryResult.map(x => x.name || x._id),
      success: r => {
        const picked = this.data.queryResult[r.tapIndex]
        wx.navigateTo({
          url: '/pages/exam/exam?mock=1&subjectId=' + encodeURIComponent(picked._id)
        })
      }
    })
  },

  // —— 大按钮：考试安排 ——
  goExamSchedule() {
    wx.navigateTo({ url: '/pages/examSchedule/index' })
  },

  // —— 考试卡片点击 ——
  onTapExamCard() {
    const cur = this.data.currentExam
    if (!cur) {
      // 卡片为空时点击也跳到考试安排页（方便用户看完整列表）
      wx.navigateTo({ url: '/pages/examSchedule/index' })
      return
    }
    if (cur.status === 'ongoing') {
      wx.navigateTo({
        url: '/pages/exam/exam?assessmentId=' + encodeURIComponent(cur._id)
      })
    } else {
      // 未开考：跳到考试安排页看详情
      wx.navigateTo({ url: '/pages/examSchedule/index' })
    }
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
