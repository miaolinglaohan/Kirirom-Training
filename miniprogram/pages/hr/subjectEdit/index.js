const app = getApp()

Page({
  data: {
    isEdit: false,
    saving: false,
    loadingExams: true,
    exams: [],
    pidIndex: -1,
    form: { _id: '', name: '', pid: '' }
  },

  onLoad(opts) {
    this.id = (opts && opts.id) ? String(opts.id) : ''
    this.setData({ isEdit: !!this.id })
    wx.setNavigationBarTitle({ title: this.id ? '编辑题库' : '新建题库' })
    if (this.id) {
      this.setData({ 'form._id': this.id })
    }
  },

  onShow() {
    app.guardAuth().then(emp => {
      if (!emp) return
      if (emp.role !== 'hr' && emp.role !== 'admin') {
        wx.showToast({ icon: 'none', title: '无权访问' })
        setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 800)
        return
      }
      this.loadExams()
    })
  },

  loadExams() {
    this.setData({ loadingExams: true })
    wx.cloud.callFunction({ name: 'hrListExams' })
      .then(res => {
        const r = res.result || {}
        if (!r.ok) {
          wx.showToast({ icon: 'none', title: r.msg || '一级试卷加载失败' })
          this.setData({ loadingExams: false })
          return
        }
        const exams = r.list || []
        this.setData({ exams, loadingExams: false }, () => {
          if (this.id) this.loadExisting()
        })
      })
      .catch(err => {
        console.error(err)
        wx.showToast({ icon: 'none', title: '网络异常' })
        this.setData({ loadingExams: false })
      })
  },

  loadExisting() {
    wx.cloud.callFunction({ name: 'hrListSubjects' })
      .then(res => {
        const r = res.result || {}
        if (!r.ok) return
        const s = (r.list || []).find(x => x._id === this.id)
        if (!s) {
          wx.showToast({ icon: 'none', title: '题库不存在' })
          return
        }
        const idx = this.data.exams.findIndex(e => e._id === s.pid)
        this.setData({
          form: { _id: s._id, name: s.name || '', pid: s.pid || '' },
          pidIndex: idx
        })
      })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
  },

  onPidChange(e) {
    const idx = Number(e.detail.value)
    const ex = this.data.exams[idx]
    if (!ex) return
    this.setData({ pidIndex: idx, 'form.pid': ex._id })
  },

  onSubmit() {
    if (this.data.saving) return
    const f = this.data.form
    if (!f._id || !f._id.trim()) return wx.showToast({ icon: 'none', title: '请填写题库编号' })
    if (!/^[A-Za-z0-9_-]+$/.test(f._id.trim())) {
      return wx.showToast({ icon: 'none', title: '编号只能含字母/数字/_/-' })
    }
    if (!f.name || !f.name.trim()) return wx.showToast({ icon: 'none', title: '请填写题库名称' })
    if (!f.pid) return wx.showToast({ icon: 'none', title: '请选择所属一级试卷' })

    this.setData({ saving: true })
    wx.cloud.callFunction({
      name: 'hrSaveSubject',
      data: {
        _id: f._id.trim(),
        name: f.name.trim(),
        pid: f.pid,
        isCreate: !this.data.isEdit
      }
    }).then(res => {
      this.setData({ saving: false })
      const r = res.result || {}
      if (r.ok) {
        wx.showToast({ icon: 'success', title: r.mode === 'update' ? '已更新' : '已创建' })
        setTimeout(() => wx.navigateBack(), 600)
        return
      }
      wx.showToast({ icon: 'none', title: r.message || r.msg || '保存失败' })
    }).catch(err => {
      console.error(err)
      this.setData({ saving: false })
      wx.showToast({ icon: 'none', title: '网络异常' })
    })
  }
})
