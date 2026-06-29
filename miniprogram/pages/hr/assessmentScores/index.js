const app = getApp()

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  const pad = n => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const STATUS_LABEL = {
  submitted:   { text: '已交卷', cls: 'submitted' },
  in_progress: { text: '答题中', cls: 'progress' },
  absent:      { text: '缺考',   cls: 'absent' }
}

const TABS = [
  { key: 'all',         label: '全部' },
  { key: 'submitted',   label: '已交卷' },
  { key: 'in_progress', label: '答题中' },
  { key: 'absent',      label: '缺考' }
]

Page({
  data: {
    assessmentId: '',
    loading: true,
    assessment: null,
    meta: '',
    summary: { expected: 0, submitted: 0, inProgress: 0, absent: 0, avgScore: null },
    avgScoreText: '—',
    tabs: TABS,
    activeTab: 'all',
    applicants: [],     // 原始列表（来自云函数）
    visibleList: []     // 按 tab 过滤后的渲染列表
  },

  onLoad(opt) {
    const id = (opt && opt.id) || ''
    if (!id) {
      wx.showToast({ icon: 'none', title: '缺少考试 ID' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.setData({ assessmentId: id })
  },

  onShow() {
    if (!this.data.assessmentId) return
    app.guardAuth().then(emp => {
      if (!emp) return
      if (emp.role !== 'hr' && emp.role !== 'admin') {
        wx.showToast({ icon: 'none', title: '无权访问' })
        setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 800)
        return
      }
      this.loadScores()
    })
  },

  loadScores() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'hrListAssessmentScores',
      data: { assessmentId: this.data.assessmentId }
    }).then(res => {
      const r = res.result || {}
      if (!r.ok) {
        wx.showToast({ icon: 'none', title: r.message || '加载失败' })
        this.setData({ loading: false })
        return
      }
      const a = r.assessment || {}
      const meta = [
        '开考 ' + fmtTime(a.startTime),
        '时长 ' + (a.duration || 0) + 'min',
        '题量 ' + (a.totalQuestions || 0),
        '满分 ' + (a.fullScore || 0)
      ].join(' · ')

      const applicants = (r.applicants || []).map(p => {
        const sl = STATUS_LABEL[p.status] || { text: p.status, cls: '' }
        return Object.assign({}, p, {
          statusText: sl.text,
          statusCls: sl.cls,
          scoreText: p.status === 'submitted' && p.score != null
            ? p.score + ' / ' + (p.fullScore || 0)
            : '',
          submittedAtText: p.submittedAt ? fmtTime(p.submittedAt) : '',
          startedAtText: p.startedAt ? fmtTime(p.startedAt) : ''
        })
      })

      const summary = r.summary || { expected: 0, submitted: 0, inProgress: 0, absent: 0, avgScore: null }
      const avgScoreText = summary.avgScore == null ? '—' : String(summary.avgScore)

      this.setData({
        loading: false,
        assessment: a,
        meta,
        summary,
        avgScoreText,
        applicants
      }, () => this.applyFilter())
    }).catch(err => {
      console.error('[assessmentScores] 加载失败', err)
      wx.showToast({ icon: 'none', title: '网络异常' })
      this.setData({ loading: false })
    })
  },

  onTabTap(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.activeTab) return
    this.setData({ activeTab: key }, () => this.applyFilter())
  },

  applyFilter() {
    const k = this.data.activeTab
    const list = k === 'all'
      ? this.data.applicants
      : this.data.applicants.filter(p => p.status === k)
    this.setData({ visibleList: list })
  },

  // 点击已交卷条目跳转复盘（复用员工端 review 页：传 enrollmentId 当 id 用）
  // TODO: review 页目前是按 historys.id 复盘，HR 通过 enrollmentId 复盘需要 review 页适配。
  //       v0.3.3 先不接，留作下一版增强；当前 tap 仅 toast 提示。
  onTapApplicant(e) {
    const idx = e.currentTarget.dataset.idx
    const p = this.data.visibleList[idx]
    if (!p) return
    if (p.status === 'submitted') {
      wx.showToast({ icon: 'none', title: '复盘功能后续版本提供' })
    } else if (p.status === 'in_progress') {
      wx.showToast({ icon: 'none', title: p.name + ' 答题进行中' })
    } else {
      wx.showToast({ icon: 'none', title: p.name + ' 未参加考试' })
    }
  },

  onPullDownRefresh() {
    this.loadScores()
    wx.stopPullDownRefresh()
  }
})
