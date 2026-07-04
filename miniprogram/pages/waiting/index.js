// pages/waiting/index.js
//
// 候考页：员工从首页/考试安排页点"未开考"的考试进入此页。
// 展示考试信息 + 实时倒计时，归零后"进入考场"按钮亮起。
//
// 取数：复用 listMyAssessments 云函数（已返回 name/startMs/endMs/duration/
//       totalQuestions/fullScore/targetDepts/status 等全部字段，无需新建云函数）。
// 时间：用服务端返回的 now 校准 serverOffset，防止改本地时间作弊（与 examSchedule 一致）。
// 跳转：倒计时归零后手动点按钮进考场（不自动跳，员工可能还没准备好）。

const app = getApp()

Page({
  data: {
    loading: true,
    notFound: false,        // 考试不存在/不可见/部门不符
    assessment: null,       // 原始考试对象（保留 startMs/endMs 等字段）
    // 展示用字段
    name: '',
    startTimeText: '',
    durationText: '',
    questionsText: '',
    fullScoreText: '',
    deptText: '',
    // 倒计时
    countdownText: '00:00:00',
    canEnter: false,        // 倒计时归零 → true
    serverOffset: 0
  },

  onLoad(options) {
    this.assessmentId = options.id || ''
    if (!this.assessmentId) {
      this.setData({ loading: false, notFound: true })
      return
    }
    this.loadAssessment()
  },

  onUnload() {
    this.stopTick()
  },

  // —— 取数 ——
  loadAssessment() {
    wx.cloud.callFunction({
      name: 'listMyAssessments',
      data: { onlyActive: false }
    }).then(res => {
      const r = res.result || {}
      if (!r.ok || !r.list) {
        console.error('[waiting] listMyAssessments 拒绝', r)
        this.setData({ loading: false, notFound: true })
        if (r.code !== 'UNACTIVATED') {
          wx.showToast({ icon: 'none', title: r.message || '加载失败' })
        }
        return
      }
      const found = (r.list || []).find(x => x._id === this.assessmentId)
      if (!found) {
        this.setData({ loading: false, notFound: true })
        return
      }
      this.setData({ serverOffset: (r.now || Date.now()) - Date.now() })
      this.applyAssessment(found)
      this.startTick()
    }).catch(err => {
      console.error('[waiting] listMyAssessments 失败', err)
      this.setData({ loading: false, notFound: true })
      wx.showToast({ icon: 'none', title: '网络异常' })
    })
  },

  // 把原始 assessment 拆成展示字段
  applyAssessment(a) {
    const start = a.startMs || new Date(a.startTime || 0).getTime()
    const end = a.endMs || (start + (a.duration || 0) * 60 * 1000)
    this.setData({
      loading: false,
      assessment: { ...a, startMs: start, endMs: end },
      name: a.name || '未命名考试',
      startTimeText: this.fmtTime(start),
      durationText: a.duration ? (a.duration + ' 分钟') : '',
      questionsText: (a.totalQuestions || a.questionCount)
        ? ((a.totalQuestions || a.questionCount) + ' 题')
        : '',
      fullScoreText: a.fullScore ? (a.fullScore + ' 分') : '',
      deptText: this.fmtDepts(a.targetDepts)
    })
    this.refreshCountdown()
  },

  fmtTime(ts) {
    if (!ts) return '待定'
    const d = new Date(ts)
    const pad = n => (n < 10 ? '0' + n : '' + n)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  },

  fmtDepts(depts) {
    if (!Array.isArray(depts) || depts.length === 0) return '全员'
    return depts.join(' / ')
  },

  // —— 倒计时 ——
  refreshCountdown() {
    const a = this.data.assessment
    if (!a) return
    const now = Date.now() + this.data.serverOffset
    const remain = a.startMs - now
    if (remain <= 0) {
      this.setData({ countdownText: '00:00:00', canEnter: true })
      this.stopTick()
      return
    }
    this.setData({ countdownText: this.fmtCountdown(remain), canEnter: false })
  },

  fmtCountdown(ms) {
    const totalSec = Math.floor(ms / 1000)
    const d = Math.floor(totalSec / 86400)
    const h = Math.floor((totalSec % 86400) / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    const pad = n => (n < 10 ? '0' + n : '' + n)
    if (d > 0) return `${d} 天 ${pad(h)}:${pad(m)}:${pad(s)}`
    return `${pad(h)}:${pad(m)}:${pad(s)}`
  },

  startTick() {
    this.stopTick()
    this.tickTimer = setInterval(() => {
      this.refreshCountdown()
    }, 1000)
  },

  stopTick() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
  },

  // —— 进入考场 ——
  onEnterExam() {
    if (!this.data.canEnter) {
      wx.showToast({ icon: 'none', title: '考试尚未开始' })
      return
    }
    wx.navigateTo({
      url: '/pages/exam/exam?assessmentId=' + encodeURIComponent(this.assessmentId)
    })
  },

  // —— 返回 ——
  onBack() {
    wx.navigateBack({ delta: 1, fail: () => {
      wx.switchTab({ url: '/pages/home/index' })
    }})
  }
})
