const app = getApp()

function pad(n) { return n < 10 ? '0' + n : '' + n }
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function parseStart(s) {
  // 兼容三种入库形态：
  //   1) ISO 字符串 '2026-07-04T13:00:00.000Z'（v0.4.1 起新数据）
  //   2) 旧格式 'YYYY-MM-DD HH:mm:ss'（v0.4.1 前的存量数据，按云函数环境 UTC 解析入库）
  //   3) Date 对象 / 时间戳
  // new Date(s) 都能解析，之后用本地时区的 getHours/getDate 回填表单，HR 看到的就是"本地几点"
  if (!s) return { date: todayStr(), time: '09:00' }
  const d = new Date(s)
  if (isNaN(d.getTime())) return { date: todayStr(), time: '09:00' }
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
}

// 把表单里的 date + time 按"HR 所在本地时区"拼成 Date，再转 ISO 字符串。
// 这样云函数 new Date(iso) 能拿到正确的时间戳，不再受 Node 默认 UTC 解析影响。
function buildIsoStart(dateStr, timeStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  const [h, mi] = String(timeStr).split(':').map(Number)
  // new Date(年, 月-1, 日, 时, 分) —— 数值构造一定按执行环境的本地时区
  const dt = new Date(y, (m || 1) - 1, d || 1, h || 0, mi || 0, 0, 0)
  return isNaN(dt.getTime()) ? '' : dt.toISOString()
}

// 取本地时区偏移文案，如 "UTC+7" / "UTC-5"
// 微信小程序运行在 HR 手机/PC 上，偏移即 HR 所在时区
function tzLabel() {
  const off = -new Date().getTimezoneOffset() / 60  // JS 规定：getTimezoneOffset 返回的是 UTC - local，要取反
  const sign = off >= 0 ? '+' : ''
  return `UTC${sign}${off}`
}

Page({
  data: {
    isEdit: false,
    saving: false,
    loadingSubjects: true,
    subjects: [],        // [{_id,name}]
    subjectIndex: -1,
    // 部门选择
    allDepts: ['项目部', '运行检修部', '综合管理部', '枢纽管理部', '安全技术部', '财务资金部'],
    showDeptPicker: false,
    form: {
      _id: '',
      name: '',
      subjectId: '',
      date: todayStr(),
      time: '09:00',
      duration: 60,
      validHours: 48,
      singleCount: 5, singleScore: 10,
      multiCount: 3,  multiScore: 15,
      judgeCount: 5,  judgeScore: 5,
      targetDepts: [],     // [] = 全员，非空 = 指定部门
      visible: true
    },
    tzLabel: tzLabel(),
    deptDisplayText: '全部部门',  // 部门选择显示文案
    isAllDepts: true,             // 是否全选
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
          validHours: a.validHours || 48,
          singleCount: single.count || 0, singleScore: single.score || 0,
          multiCount: multi.count || 0,   multiScore: multi.score || 0,
          judgeCount: judge.count || 0,   judgeScore: judge.score || 0,
          targetDepts: Array.isArray(a.targetDepts) ? [...a.targetDepts] : [],
          visible: a.visible !== false
        }
        let idx = this.data.subjects.findIndex(s => s._id === newForm.subjectId)
        this.setData({ form: newForm, subjectIndex: idx }, () => {
          this.refreshDeptDisplay()
        })
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

  // ── 部门选择器 ──

  // 刷新部门显示文案和全选状态
  refreshDeptDisplay() {
    const depts = this.data.form.targetDepts || []
    const all = this.data.allDepts
    const isAll = depts.length === 0 || depts.length === all.length
    let text = '全部部门'
    if (depts.length > 0 && depts.length < all.length) {
      text = `已选 ${depts.length} 个部门`
    }
    this.setData({ deptDisplayText: text, isAllDepts: isAll })
  },

  onToggleDeptPicker() {
    this.setData({ showDeptPicker: !this.data.showDeptPicker })
  },

  onDeptCheckChange(e) {
    const dept = e.currentTarget.dataset.dept
    let depts = this.data.form.targetDepts || []
    const all = this.data.allDepts
    // 当前全选状态：depts 为空或长度=6
    const wasAll = depts.length === 0 || depts.length === all.length
    if (wasAll) {
      depts = [...all]  // 把隐式全选展开为显式数组
    }
    const idx = depts.indexOf(dept)
    if (idx >= 0) {
      depts.splice(idx, 1)
    } else {
      depts.push(dept)
    }
    // 最少 1 个
    if (depts.length === 0) {
      wx.showToast({ icon: 'none', title: '至少保留 1 个部门' })
      depts = [dept]  // 恢复
      return
    }
    // 如果又全选了，归一化为空数组
    if (depts.length === all.length) {
      depts = []
    }
    this.setData({ 'form.targetDepts': depts }, () => {
      this.refreshDeptDisplay()
    })
  },

  onSelectAllDepts() {
    const all = this.data.allDepts
    const depts = this.data.form.targetDepts || []
    const wasAll = depts.length === 0 || depts.length === all.length
    if (wasAll) {
      // 取消全选 → 默认保留第 1 个（最小要求）
      this.setData({ 'form.targetDepts': [all[0]] }, () => {
        this.refreshDeptDisplay()
      })
    } else {
      // 全选 → 空数组
      this.setData({ 'form.targetDepts': [] }, () => {
        this.refreshDeptDisplay()
      })
    }
  },

  // ── 提交 ──
  onSubmit() {
    if (this.data.saving) return
    const f = this.data.form
    if (!f.name || !f.name.trim()) return wx.showToast({ icon: 'none', title: '请填写考试名称' })
    if (!f.subjectId) return wx.showToast({ icon: 'none', title: '请选择题库' })
    const startTime = buildIsoStart(f.date, f.time)
    if (!startTime) return wx.showToast({ icon: 'none', title: '开始时间格式无效' })
    const duration = Number(f.duration) || 0
    if (duration <= 0) return wx.showToast({ icon: 'none', title: '时长必须大于 0' })
    const validHours = Number(f.validHours) || 0
    if (!(validHours > 0)) return wx.showToast({ icon: 'none', title: '有效期必须大于 0 小时' })
    if (validHours > 168) return wx.showToast({ icon: 'none', title: '有效期不能超过 168 小时' })

    const targetDepts = f.targetDepts || []   // 空数组 = 全员，已由部门选择器维护

    const payload = {
      _id: f._id || undefined,
      name: f.name.trim(),
      subjectId: f.subjectId,
      startTime,
      duration,
      validHours,
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
    if (r.code === 'ALREADY_ENDED' || r.code === 'EXPIRED') {
      wx.showModal({
        title: '无法编辑',
        content: r.message || '该考试已结束，不可编辑',
        showCancel: false,
        success: () => wx.navigateBack()
      })
      return
    }
    wx.showToast({ icon: 'none', title: r.message || r.msg || '保存失败' })
  }
})
