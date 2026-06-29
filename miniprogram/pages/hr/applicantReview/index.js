// miniprogram/pages/hr/applicantReview/index.js
//
// HR 复盘页：给指定 enrollmentId 渲染该员工本场考试的完整答卷。
//
// 数据来源：云函数 hrGetApplicantReview（HR 鉴权 + 一次性返回所有渲染数据）
//
// 选项配色规则（与 pages/review 完全一致）：
//   - 用户选 ∩ 正确  → answered-right （绿）
//   - 用户选 ∩ !正确 → answered-wrong（红）
//   - 没选 ∩ 正确    → official-only  （绿虚框）
//   - 其他          → plain
//
// HR 视角特有：
//   - 顶栏显示员工姓名 / 部门 / 角色，及切屏次数（>0 高亮红色）
//   - 题目导航网格：每题一格，按对错染色，可点击跳转，方便 HR 直接跳到错题

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
    enrollmentId: '',
    loading: true,

    // 顶栏
    assessmentName: '',
    employeeName: '',
    employeeDept: '',
    employeeRole: '',
    submittedAtText: '',
    score: 0,
    fullScore: 0,
    rightNum: 0,
    total: 0,
    switchCount: 0,
    isMock: false,

    // 题目导航网格 [{idx, label, right}]
    navList: [],

    // 当前题
    idx: 0,
    isLast: false,
    percent: 0,
    item: null,
    isJudge: false,
    optionLines: [],
    userText: '-',
    officialText: '-',
    right: false,

    // 原始数据（不上 setData，避免无谓 diff）
    _questions: [],
    _userAnswers: {},
    _officialMap: {},
    _rightFlags: []
  },

  onLoad(opt) {
    const id = (opt && opt.id) || ''
    if (!id) {
      wx.showToast({ icon: 'none', title: '缺少 enrollmentId' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.setData({ enrollmentId: id })
  },

  onShow() {
    if (!this.data.enrollmentId) return
    app.guardAuth().then(emp => {
      if (!emp) return
      if (emp.role !== 'hr' && emp.role !== 'admin') {
        wx.showToast({ icon: 'none', title: '无权访问' })
        setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 800)
        return
      }
      // 只在首次进入时加载（页内翻题用 setData，不再请求云端）
      if (!this._loaded) this.loadReview()
    })
  },

  loadReview() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'hrGetApplicantReview',
      data: { enrollmentId: this.data.enrollmentId }
    }).then(res => {
      const r = res.result || {}
      if (!r.ok) {
        wx.showToast({ icon: 'none', title: r.message || '加载失败' })
        this.setData({ loading: false })
        return
      }

      const questions = r.questions || []
      const userAnswers = r.userAnswers || {}
      const officialMap = {}
      ;(r.answersOfficial || []).forEach(a => {
        officialMap[a.qid] = (a.correctCodes || []).map(c => String(c).toUpperCase())
      })

      // 计算每题对错（与 submitExam 同口径：集合相等才算对）
      const rightFlags = questions.map(q => {
        const u = (userAnswers[q._id] || [])
        const uSorted = (Array.isArray(u) ? u : [u])
          .map(c => String(c).toUpperCase()).filter(Boolean).sort().join(',')
        const o = (officialMap[q._id] || []).slice().sort().join(',')
        return uSorted !== '' && uSorted === o
      })

      const navList = questions.map((q, i) => ({
        idx: i,
        label: String(i + 1),
        right: rightFlags[i]
      }))

      this._loaded = true
      this._questions = questions
      this._userAnswers = userAnswers
      this._officialMap = officialMap
      this._rightFlags = rightFlags

      this.setData({
        loading: false,
        assessmentName: (r.assessment && r.assessment.name) || '',
        employeeName: (r.employee && r.employee.name) || '',
        employeeDept: (r.employee && r.employee.dept) || '',
        employeeRole: (r.employee && r.employee.role) || 'employee',
        submittedAtText: fmtTime(r.enrollment && r.enrollment.submittedAt),
        score: (r.enrollment && r.enrollment.score) || 0,
        fullScore: (r.enrollment && r.enrollment.fullScore) || 0,
        rightNum: (r.enrollment && r.enrollment.rightNum) || 0,
        total: (r.enrollment && r.enrollment.total) || questions.length,
        switchCount: (r.enrollment && r.enrollment.switchCount) || 0,
        isMock: !!(r.enrollment && r.enrollment.isMock),
        navList
      }, () => {
        if (questions.length > 0) this.renderIdx(0)
      })
    }).catch(err => {
      console.error('[hr.applicantReview] 云函数调用失败', err)
      wx.showToast({ icon: 'none', title: '网络异常' })
      this.setData({ loading: false })
    })
  },

  renderIdx(idx) {
    const questions = this._questions || []
    if (idx < 0 || idx >= questions.length) return
    const q = questions[idx]

    const userAns = this._userAnswers[q._id] || []
    const userSet = {}
    ;(Array.isArray(userAns) ? userAns : [userAns]).forEach(c => {
      if (c) userSet[String(c).toUpperCase()] = true
    })

    const officialCodes = this._officialMap[q._id] || []
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
    const right = !!this._rightFlags[idx]
    const total = questions.length

    this.setData({
      idx,
      item: q,
      isJudge: String(q.typecode || '01') === '03',
      optionLines,
      userText: userKeys.length ? userKeys.join('、') : '未作答',
      officialText: officialKeys.length ? officialKeys.join('、') : '-',
      right,
      isLast: idx === total - 1,
      percent: total ? Math.round(((idx + 1) / total) * 100) : 0
    })
  },

  onTapNav(e) {
    const i = Number(e.currentTarget.dataset.idx)
    if (isNaN(i)) return
    if (i === this.data.idx) return
    this.renderIdx(i)
  },

  goPrev() {
    if (this.data.idx > 0) this.renderIdx(this.data.idx - 1)
  },

  goNext() {
    const total = (this._questions || []).length
    if (this.data.idx < total - 1) this.renderIdx(this.data.idx + 1)
    else wx.navigateBack({ delta: 1 })
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  }
})
