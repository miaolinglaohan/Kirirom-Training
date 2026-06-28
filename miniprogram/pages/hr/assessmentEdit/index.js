const app = getApp()

function pad(n) { return n < 10 ? '0' + n : '' + n }
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function parseStart(s) {
  // 'YYYY-MM-DD HH:mm:ss' or ISO
  if (!s) return { date: todayStr(), time: '09:00' }
  const d = new Date(s)
  if (isNaN(d.getTime())) return { date: todayStr(), time: '09:00' }
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
}

Page({
  data: {
    isEdit: false,
    saving: false,
    loadingSubjects: true,
    subjects: [],        // [{_id,name}]
    subjectIndex: -1,
    form: {
      _id: '',
      name: '',
      subjectId: '',
      date: todayStr(),
      time: '09:00',
      duration: 60,
      singleCount: 5, singleScore: 10,
      multiCount: 3,  multiScore: 15,
      judgeCount: 5,  judgeScore: 5,
      targetDeptsText: '',
      visible: true
    }
  },

  onLoad(opts) {
    this.id = (opts && opts.id) ? String(opts.id) : ''
    this.setData({ isEdit: !!this.id })
    wx.setNavigationBarTitle({ title: this.id ? '编辑考试' : '新建考试' })
  },

  onShow() {
    app.guardAuth().then(emp => {
      if (!emp) return
      if (emp.role !== 'hr' && emp.role !== 'admin') {
        wx.showToast({ icon: 'none', title: '无权访问' })
        setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 800)
        return
      }
      this.loadSubjects()
      if (this.id) this.loadExisting()
    })
  },

  loadSubjects() {
    this.setData({ loadingSubjects: true })
    // 改走 hrListSubjects 云函数：
    //   1) 修旧 bug —— 原实现查 exam 集合（一级试卷，1~2 条），但 assessments.subjectId
    //      实际应该指向 subjects._id（题库二级），picker 选错集合会导致 hrSaveAssessment
    //      报 SUBJECT_NOT_FOUND
    //   2) 顺带消除"全量查询告警"（服务端查询不会触发客户端告警）
    wx.cloud.callFunction({ name: 'hrListSubjects' })
      .then(res => {
        const r = res.result || {}
        if (!r.ok) {
          this.setData({ loadingSubjects: false })
          wx.showToast({ icon: 'none', title: r.msg || '题库加载失败' })
          return
        }
        const exams = r.exams || []
        const examMap = {}
        exams.forEach(e => { examMap[e._id] = e.name || e._id })
        // 标签拼成「题库名（一级试卷名）」，方便 HR 在多个 exam 下区分同名题库
        const subjects = (r.list || []).map(s => {
          const ex = examMap[s.pid]
          const label = ex ? `${s.name || s._id}（${ex}）` : (s.name || s._id)
          return { _id: s._id, name: label }
        })
        let idx = -1
        if (this.data.form.subjectId) {
          idx = subjects.findIndex(s => s._id === this.data.form.subjectId)
        }
        this.setData({ subjects, subjectIndex: idx, loadingSubjects: false })
      })
      .catch(err => {
        console.error('load subjects', err)
        this.setData({ loadingSubjects: false })
        wx.showToast({ icon: 'none', title: '题库加载失败' })
      })
  },

  loadExisting() {
    wx.cloud.callFunction({ name: 'hrListAssessments' })
      .then(res => {
        const r = res.result || {}
        if (!r.ok) return
        const a = (r.list || []).find(x => x._id === this.id)
        if (!a) {
          wx.showToast({ icon: 'none', title: '考试不存在' })
          return
        }
        const t = parseStart(a.startTime)
        const qc = a.questionConfig || {}
        const single = qc.single || { count: 0, score: 0 }
        const multi = qc.multi || { count: 0, score: 0 }
        const judge = qc.judge || { count: 0, score: 0 }
        const newForm = {
          _id: a._id,
          name: a.name || '',
          subjectId: a.subjectId || '',
          date: t.date, time: t.time,
          duration: a.duration || 60,
          singleCount: single.count || 0, singleScore: single.score || 0,
          multiCount: multi.count || 0,   multiScore: multi.score || 0,
          judgeCount: judge.count || 0,   judgeScore: judge.score || 0,
          targetDeptsText: Array.isArray(a.targetDepts) ? a.targetDepts.join(',') : '',
          visible: a.visible !== false
        }
        let idx = this.data.subjects.findIndex(s => s._id === newForm.subjectId)
        this.setData({ form: newForm, subjectIndex: idx })
      })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    const v = e.detail.value
    this.setData({ ['form.' + field]: v })
  },

  onSubjectChange(e) {
    const idx = Number(e.detail.value)
    const s = this.data.subjects[idx]
    if (!s) return
    this.setData({ subjectIndex: idx, 'form.subjectId': s._id })
  },

  onDateChange(e) { this.setData({ 'form.date': e.detail.value }) },
  onTimeChange(e) { this.setData({ 'form.time': e.detail.value }) },
  onVisibleChange(e) { this.setData({ 'form.visible': e.detail.value }) },

  onSubmit() {
    if (this.data.saving) return
    const f = this.data.form
    if (!f.name || !f.name.trim()) return wx.showToast({ icon: 'none', title: '请填写考试名称' })
    if (!f.subjectId) return wx.showToast({ icon: 'none', title: '请选择题库' })
    const startTime = `${f.date} ${f.time}:00`
    const duration = Number(f.duration) || 0
    if (duration <= 0) return wx.showToast({ icon: 'none', title: '时长必须大于 0' })

    const targetDepts = String(f.targetDeptsText || '')
      .split(/[,，\s]+/)
      .map(s => s.trim())
      .filter(Boolean)

    const payload = {
      _id: f._id || undefined,
      name: f.name.trim(),
      subjectId: f.subjectId,
      startTime,
      duration,
      questionConfig: {
        single: { count: Number(f.singleCount) || 0, score: Number(f.singleScore) || 0 },
        multi:  { count: Number(f.multiCount)  || 0, score: Number(f.multiScore)  || 0 },
        judge:  { count: Number(f.judgeCount)  || 0, score: Number(f.judgeScore)  || 0 }
      },
      targetDepts,
      visible: !!f.visible
    }

    this.setData({ saving: true })
    wx.cloud.callFunction({ name: 'hrSaveAssessment', data: payload })
      .then(res => {
        this.setData({ saving: false })
        const r = res.result || {}
        if (r.ok) {
          wx.showToast({ icon: 'success', title: r.mode === 'update' ? '已更新' : '已创建' })
          setTimeout(() => wx.navigateBack(), 600)
          return
        }
        this.showErr(r)
      })
      .catch(err => {
        console.error(err)
        this.setData({ saving: false })
        wx.showToast({ icon: 'none', title: '网络异常' })
      })
  },

  showErr(r) {
    if (r.code === 'NOT_ENOUGH_QUESTIONS') {
      const detail = Array.isArray(r.detail) ? r.detail : []
      const typeName = { '01': '单选', '02': '多选', '03': '判断' }
      const lines = detail.map(d => `${typeName[d.typecode] || d.typecode}：需要 ${d.need}，仅有 ${d.have}`)
      wx.showModal({
        title: '题库题量不足',
        content: lines.join('\n') || '请补充题库',
        showCancel: false
      })
      return
    }
    if (r.code === 'FORBIDDEN') {
      wx.showToast({ icon: 'none', title: '无 HR 权限' })
      return
    }
    wx.showToast({ icon: 'none', title: r.message || r.msg || '保存失败' })
  }
})
