// miniprogram/pages/exam/exam.js
//
// Phase 2 重写：对接服务端 4 个云函数（getServerTime / enterExam / saveDraft / submitExam）
// 防作弊要点：
//   ① 题目与官方答案均由服务端下发；前端只能看到题目（不含 value）
//   ② 倒计时基于服务器时间 = Date.now() + serverOffset
//   ③ 每 30 秒自动 saveDraft 一次；切后台时累计 switchCount 并尝试上送
//   ④ 时间归零 → 自动 submitExam；用户提交也走同一接口
//
// 入参（URL query）：
//   正式考试：assessmentId=xxx
//   模拟考试：mock=1&subjectId=xxx&questionCount=10&duration=10
//
// 关键数据：
//   answers: { [qid]: ['A','C'] }           // 用户作答
//   questions: 服务端返回的题目数组（已剥离 value）
//   curIdx: 当前题号下标
//   deadlineAt: 服务端给的截止时间戳（毫秒）
//   serverOffset: 服务端时间与本地的偏移量

const AUTO_SAVE_INTERVAL_MS = 30 * 1000

const app = getApp()

Page({
  data: {
    // 加载/状态
    loading: true,
    submitting: false,
    enrollmentId: '',
    isMock: false,
    resumed: false,

    // 题目
    questions: [],
    total: 0,
    fullScore: 0,
    questionConfig: null,
    curIdx: 0,
    question: null,        // 当前题
    options: [],           // 当前题的选项（含 selected 标记）
    isMulti: false,        // 是否多选
    isJudge: false,        // 是否判断题（Phase 3：渲染大按钮 UI）

    // 答案：{ qid: ['A'] }
    answers: {},
    // 答题进度展示：[true/false]，记录是否已作答
    answeredMask: [],

    // 倒计时
    deadlineAt: 0,
    serverOffset: 0,
    remainText: '--:--',
    timeLow: false,         // 剩余 ≤ 1 分钟，UI 变红
    expired: false,         // 时间已到

    // 切后台
    pendingSwitchCount: 0,
    showSwitchToast: false,

    // 跳题面板
    showJumpPanel: false,

    // 调试/进度
    lastSavedText: ''
  },

  // ─────────────────────────────── 生命周期 ───────────────────────────────

  onLoad(query) {
    const isMock = query.mock === '1' || query.isMock === 'true'
    const params = isMock
      ? {
          isMock: true,
          subjectId: query.subjectId || '',
          questionCount: Number(query.questionCount) || undefined,
          duration: Number(query.duration) || undefined
        }
      : { assessmentId: query.assessmentId || '' }

    this.setData({ isMock })

    wx.showLoading({ title: '进入考场...', mask: true })
    // 并行：getServerTime + enterExam
    Promise.all([
      this.callServerTime(),
      this.callEnterExam(params)
    ]).then(([_, enterRes]) => {
      wx.hideLoading()
      if (!enterRes || !enterRes.ok) {
        this.failExit(enterRes)
        return
      }
      this.bootstrapExam(enterRes)
    }).catch(err => {
      wx.hideLoading()
      console.error('[exam] 进入考场失败', err)
      this.failExit({ message: '进入考场失败：' + (err && err.errMsg || err) })
    })
  },

  onHide() {
    // 切到后台 / 系统弹层 → 累加切换次数，并尽量上送一次
    this.setData({ pendingSwitchCount: this.data.pendingSwitchCount + 1 })
    this.saveDraftSilently()
  },

  onUnload() {
    this.stopAllTimers()
    // 最后一搏：尝试再保存一次（不强求成功）
    this.saveDraftSilently()
  },

  // ─────────────────────────────── 启动 ───────────────────────────────

  callServerTime() {
    return wx.cloud.callFunction({ name: 'getServerTime' }).then(res => {
      const serverNow = res && res.result && res.result.now
      if (typeof serverNow === 'number') {
        this.setData({ serverOffset: serverNow - Date.now() })
      }
    }).catch(err => {
      console.warn('[exam] getServerTime 失败，使用本地时间', err)
    })
  },

  callEnterExam(data) {
    return wx.cloud.callFunction({ name: 'enterExam', data }).then(r => r.result)
  },

  bootstrapExam(res) {
    const questions = Array.isArray(res.questions) ? res.questions : []
    const answers = res.answers || {}
    const answeredMask = questions.map(q => {
      const a = answers[q._id]
      return Array.isArray(a) && a.length > 0
    })
    this.setData({
      loading: false,
      enrollmentId: res.enrollmentId,
      resumed: !!res.resumed,
      questions,
      total: res.total || questions.length,
      fullScore: res.fullScore || 0,
      questionConfig: res.questionConfig || null,
      answers,
      answeredMask,
      deadlineAt: res.deadline || 0,
      curIdx: 0
    }, () => {
      this.renderQuestion(0)
      this.startCountdown()
      this.startAutoSave()
      if (res.resumed) {
        wx.showToast({ icon: 'none', title: '继续上次作答' })
      }
    })
  },

  failExit(res) {
    const msg = (res && res.message) || '进入考场失败'
    wx.showModal({
      title: '无法进入',
      content: msg,
      showCancel: false,
      success: () => wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/index/index' }) })
    })
  },

  // ─────────────────────────────── 题目渲染 ───────────────────────────────

  renderQuestion(idx) {
    const questions = this.data.questions
    if (idx < 0 || idx >= questions.length) return
    const q = questions[idx]
    const tc = String(q.typecode || '01')
    const isMulti = tc === '02'
    const isJudge = tc === '03'
    const selectedCodes = this.data.answers[q._id] || []
    const options = (q.options || []).map(opt => ({
      ...opt,
      selected: selectedCodes.indexOf(opt.code) >= 0
    }))
    this.setData({
      curIdx: idx,
      question: q,
      options,
      isMulti,
      isJudge
    })
  },

  selectOption(e) {
    if (this.data.expired || this.data.submitting) return
    const code = e.currentTarget.dataset.code
    const qid = this.data.question._id
    const isMulti = this.data.isMulti
    const old = this.data.answers[qid] || []
    let next
    if (isMulti) {
      if (old.indexOf(code) >= 0) {
        next = old.filter(c => c !== code)
      } else {
        next = old.concat([code]).sort()
      }
    } else {
      // 单选：再次点击相同项可取消，但实战通常一旦选定不允许空
      next = (old.length === 1 && old[0] === code) ? [] : [code]
    }
    const answers = { ...this.data.answers, [qid]: next }
    const answeredMask = this.data.answeredMask.slice()
    answeredMask[this.data.curIdx] = next.length > 0
    this.setData({ answers, answeredMask })
    // 更新选项 UI
    const options = this.data.options.map(opt => ({
      ...opt,
      selected: next.indexOf(opt.code) >= 0
    }))
    this.setData({ options })
  },

  goPrev() {
    if (this.data.curIdx > 0) this.renderQuestion(this.data.curIdx - 1)
  },

  goNext() {
    if (this.data.curIdx < this.data.total - 1) {
      this.renderQuestion(this.data.curIdx + 1)
    } else {
      wx.showToast({ icon: 'none', title: '已是最后一题' })
    }
  },

  toggleJumpPanel() {
    this.setData({ showJumpPanel: !this.data.showJumpPanel })
  },

  onJumpTap(e) {
    const i = Number(e.currentTarget.dataset.i)
    this.setData({ showJumpPanel: false })
    this.renderQuestion(i)
  },

  // ─────────────────────────────── 倒计时 ───────────────────────────────

  serverNow() {
    return Date.now() + this.data.serverOffset
  },

  startCountdown() {
    this.stopCountdown()
    this.tickCountdown()
    this.countdownTimer = setInterval(() => this.tickCountdown(), 1000)
  },

  stopCountdown() {
    if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null }
  },

  tickCountdown() {
    const remain = this.data.deadlineAt - this.serverNow()
    if (remain <= 0) {
      this.setData({ remainText: '00:00', timeLow: true, expired: true })
      this.stopCountdown()
      this.autoSubmit('时间到，已自动交卷')
      return
    }
    const totalSec = Math.floor(remain / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    const pad = n => (n < 10 ? '0' + n : '' + n)
    const text = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
    this.setData({
      remainText: text,
      timeLow: remain <= 60 * 1000
    })
  },

  // ─────────────────────────────── 自动保存 ───────────────────────────────

  startAutoSave() {
    this.stopAutoSave()
    this.autoSaveTimer = setInterval(() => this.saveDraftSilently(), AUTO_SAVE_INTERVAL_MS)
  },

  stopAutoSave() {
    if (this.autoSaveTimer) { clearInterval(this.autoSaveTimer); this.autoSaveTimer = null }
  },

  stopAllTimers() {
    this.stopCountdown()
    this.stopAutoSave()
  },

  saveDraftSilently() {
    const { enrollmentId, answers, pendingSwitchCount, submitting, expired } = this.data
    if (!enrollmentId || submitting) return
    if (expired) return  // 时间到后 autoSubmit 接管
    const switchInc = pendingSwitchCount
    wx.cloud.callFunction({
      name: 'saveDraft',
      data: { enrollmentId, answers, switchCountIncrement: switchInc }
    }).then(res => {
      const r = res.result || {}
      if (r.ok) {
        // 清零已上送的 switchCount
        this.setData({
          pendingSwitchCount: Math.max(0, this.data.pendingSwitchCount - switchInc),
          lastSavedText: this.fmtSavedTime()
        })
      } else {
        console.warn('[exam] saveDraft 服务端拒绝', r)
      }
    }).catch(err => {
      console.warn('[exam] saveDraft 失败', err)
    })
  },

  fmtSavedTime() {
    const d = new Date()
    const pad = n => (n < 10 ? '0' + n : '' + n)
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  },

  // ─────────────────────────────── 提交 ───────────────────────────────

  onSubmitTap() {
    if (this.data.submitting) return
    const unanswered = this.data.answeredMask.filter(x => !x).length
    const tip = unanswered > 0
      ? `还有 ${unanswered} 题未作答，确定要交卷吗？`
      : '确认提交答卷？提交后无法修改。'
    wx.showModal({
      title: '交卷确认',
      content: tip,
      confirmText: '交卷',
      cancelText: '再检查',
      success: r => {
        if (r.confirm) this.doSubmit('用户主动交卷')
      }
    })
  },

  autoSubmit(reason) {
    if (this.data.submitting) return
    wx.showToast({ icon: 'none', title: reason })
    this.doSubmit(reason)
  },

  doSubmit(reason) {
    this.setData({ submitting: true })
    this.stopAllTimers()
    wx.showLoading({ title: '正在交卷...', mask: true })
    wx.cloud.callFunction({
      name: 'submitExam',
      data: {
        enrollmentId: this.data.enrollmentId,
        answers: this.data.answers
      }
    }).then(res => {
      wx.hideLoading()
      const r = res.result || {}
      if (!r.ok) {
        // 已提交也算成功，跳到结果页
        if (r.code === 'ALREADY_SUBMITTED') {
          wx.showToast({ icon: 'none', title: '答卷已提交' })
          this.goResultPage({ score: 0, rightNum: 0, total: this.data.total, isMock: this.data.isMock, alreadySubmitted: true })
          return
        }
        wx.showModal({
          title: '交卷失败',
          content: r.message || '请稍后重试',
          showCancel: false
        })
        this.setData({ submitting: false })
        return
      }
      this.goResultPage(r)
    }).catch(err => {
      wx.hideLoading()
      console.error('[exam] submitExam 失败', err)
      wx.showModal({
        title: '网络异常',
        content: '交卷请求失败，请检查网络后重试',
        showCancel: false
      })
      this.setData({ submitting: false })
    })
  },

  goResultPage(r) {
    // 把交卷结果存到全局，避免 URL 过长且防止参数被篡改
    const payload = {
      enrollmentId: this.data.enrollmentId,
      isMock: !!r.isMock,
      total: r.total || this.data.total,
      rightNum: r.rightNum || 0,
      score: typeof r.score === 'number' ? r.score : (r.rightNum || 0),
      fullScore: typeof r.fullScore === 'number' ? r.fullScore : (this.data.fullScore || r.total || this.data.total),
      questionConfig: r.questionConfig || this.data.questionConfig || null,
      scoreDetail: r.scoreDetail || null,
      questions: r.questions || this.data.questions,
      userAnswers: r.userAnswers || this.data.answers,
      answersOfficial: r.answersOfficial || null,
      perQuestion: r.perQuestion || null,
      switchCount: r.switchCount || 0,
      alreadySubmitted: !!r.alreadySubmitted
    }
    app.globalData = app.globalData || {}
    app.globalData.lastExamResult = payload

    const errNum = Math.max(0, payload.total - payload.rightNum)
    const url = `/pages/examresult/examresult?length=${payload.total}&rightNum=${payload.rightNum}&errNum=${errNum}&ordernum=${encodeURIComponent(this.data.enrollmentId)}&isMock=${payload.isMock ? 1 : 0}`
    wx.redirectTo({ url })
  }
})
