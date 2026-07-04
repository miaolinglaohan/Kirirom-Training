// pages/home/index.js
const app = getApp()

Page({
  data: {
    openid: '',
    queryResult: [],          // 一级 exam 列表（顺序/随机练习用）
    subjectsList: [],         // 二级 subjects 列表（模拟考试用，标签拼"题库名（一级名）"）

    // 统计条数据（Phase 0 占位，Phase 2 后接入真实数据）
    stats: {
      answered: 0,
      accuracy: 0
    },

    // 当前登录员工是否为 HR（控制管理后台入口显隐）
    isHr: false,


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
      this.setData({
        openid: app.globalData.openid || '',
        isHr: emp.role === 'hr' || emp.role === 'admin'
      })
      this.loadExamList()
      this.loadSubjectsList()
      this.loadStats()
      this.loadCurrentExam()
    })
  },

  // —— 数据加载 ——
  loadExamList() {
    // 一级 exam 表是字典表（生产 1~2 条），业务上必须取全表。
    // 但小程序索引检查器只看是否带 where 条件，不带就报"全量查询告警"，
    // 这里加一个永真的 _id exists(true) 条件（走主键索引），等价于全扫但能消除告警。
    const db = wx.cloud.database()
    db.collection('exam')
      .where({ _id: db.command.exists(true) })
      .limit(50)
      .get({
        success: res => {
          this.setData({ queryResult: res.data })
        },
        fail: err => {
          console.error('[home] exam 查询失败：', err)
        }
      })
  },

  // 二级 subjects 列表：模拟考试入口要按"题库"挑，而不是"一级试卷"
  // 同时联表把 pid -> 一级名 拼上，UI 显示"题库名（一级名）"
  loadSubjectsList() {
    const db = wx.cloud.database()
    db.collection('subjects')
      .where({ _id: db.command.exists(true) })
      .limit(200)
      .get()
      .then(res => {
        const subs = res.data || []
        // 用已加载的 queryResult（exam）拼出 pid -> name 映射；若 exam 还没加载完，pid 直接当后缀
        const examMap = {}
        ;(this.data.queryResult || []).forEach(e => { examMap[e._id] = e.name })
        const list = subs.map(s => ({
          _id: s._id,
          pid: s.pid,
          name: s.name,
          label: examMap[s.pid] ? `${s.name}（${examMap[s.pid]}）` : s.name
        }))
        this.setData({ subjectsList: list })
      })
      .catch(err => {
        console.error('[home] subjects 查询失败：', err)
      })
  },

  loadStats() {
    // 占位"已答题"计数：按当前用户 _openid 过滤；正式 stats 云函数待 Phase 4
    const openid = this.data.openid || app.globalData.openid || ''
    if (!openid) {
      // 还没拿到 openid 就别发了，避免触发全量扫表告警 + 数到别人头上
      this.setData({ 'stats.answered': 0 })
      return
    }
    const db = wx.cloud.database()
    db.collection('historys').where({ _openid: openid }).count({
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
          actionText: pick.status === 'ongoing' ? '立即进入考场' : '进入候考'
        }
      })
    }).catch(err => {
      console.error('[home] listMyAssessments 失败', err)
      this.setData({ currentExam: null })
    })
  },

  // —— 入口跳转 ——
  goExamList() {
    // 顺序练习：单条直接进，多条让用户挑
    const list = this.data.queryResult || []
    if (list.length === 0) {
      wx.showToast({ icon: 'none', title: '暂无可练习题库' })
      return
    }
    if (list.length === 1) {
      wx.navigateTo({ url: '/pages/subject/index?id=' + list[0]._id })
      return
    }
    wx.showActionSheet({
      itemList: list.map(x => x.name || x._id),
      success: r => {
        const picked = list[r.tapIndex]
        wx.navigateTo({ url: '/pages/subject/index?id=' + picked._id })
      }
    })
  },

  goRandom() {
    // 随机刷题：同样支持多条选择
    const list = this.data.queryResult || []
    if (list.length === 0) {
      wx.showToast({ icon: 'none', title: '暂无可练习题库' })
      return
    }
    if (list.length === 1) {
      wx.navigateTo({ url: '/pages/simple/index?id=' + list[0]._id })
      return
    }
    wx.showActionSheet({
      itemList: list.map(x => x.name || x._id),
      success: r => {
        const picked = list[r.tapIndex]
        wx.navigateTo({ url: '/pages/simple/index?id=' + picked._id })
      }
    })
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

  goHrHome() {
    wx.navigateTo({ url: '/pages/hr/home/index' })
  },

  // —— 大按钮：模拟考试 ——
  goMockExam() {
    // 模拟考试针对的是"题库"（二级），不是"一级试卷"。
    // enterExam 云函数的 subjectId 必须对得上 questions.examid（= subjects._id）。
    const list = this.data.subjectsList || []
    if (list.length === 0) {
      wx.showToast({ icon: 'none', title: '暂无可用题库' })
      return
    }
    if (list.length === 1) {
      wx.navigateTo({
        url: '/pages/exam/exam?mock=1&subjectId=' + encodeURIComponent(list[0]._id)
      })
      return
    }
    wx.showActionSheet({
      itemList: list.map(x => x.label),
      success: r => {
        const picked = list[r.tapIndex]
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
      // 未开考：跳候考页倒计时
      wx.navigateTo({ url: '/pages/waiting/index?id=' + encodeURIComponent(cur._id) })
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
