const app = getApp()

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  const pad = n => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

Page({
  data: {
    loading: true,
    list: []
  },

  onShow() {
    app.guardAuth().then(emp => {
      if (!emp) return
      if (emp.role !== 'hr' && emp.role !== 'admin') {
        wx.showToast({ icon: 'none', title: '无权访问' })
        setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 800)
        return
      }
      this.loadList()
    })
  },

  loadList() {
    this.setData({ loading: true })
    wx.cloud.callFunction({ name: 'hrListAssessments' })
      .then(res => {
        const r = res.result || {}
        if (!r.ok) {
          wx.showToast({ icon: 'none', title: r.msg || '加载失败' })
          this.setData({ loading: false })
          return
        }
        const list = (r.list || []).map(a => Object.assign({}, a, {
          startTimeText: fmtTime(a.startTime),
          totalQuestions: a.totalQuestions || a.questionCount || 0,
          fullScore: a.fullScore || 0,
          enrolled: a.enrolled || 0,
          submitted: a.submitted || 0
        }))
        this.setData({ loading: false, list })
      })
      .catch(err => {
        console.error(err)
        wx.showToast({ icon: 'none', title: '网络异常' })
        this.setData({ loading: false })
      })
  },

  onCreate() {
    wx.navigateTo({ url: '/pages/hr/assessmentEdit/index' })
  },

  onEdit(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/hr/assessmentEdit/index?id=' + id })
  },

  // catchtap：避免冒泡触发 .item 的 onEdit
  onScores(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/hr/assessmentScores/index?id=' + id })
  },

  onPullDownRefresh() {
    this.loadList()
    wx.stopPullDownRefresh()
  }
})
