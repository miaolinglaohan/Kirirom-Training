const app = getApp()

Page({
  data: {
    loading: true,
    groups: [],       // [{exam:{_id,name}, items:[subject...]}]
    looseItems: []    // pid 找不到对应 exam 时塞这里
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
    wx.cloud.callFunction({ name: 'hrListSubjects' })
      .then(res => {
        const r = res.result || {}
        if (!r.ok) {
          wx.showToast({ icon: 'none', title: r.msg || '加载失败' })
          this.setData({ loading: false })
          return
        }
        const exams = r.exams || []
        const list = r.list || []
        const examMap = {}
        exams.forEach(e => { examMap[e._id] = e })

        const groupMap = {}
        const orderedKeys = []
        const looseItems = []
        list.forEach(s => {
          const ex = examMap[s.pid]
          if (!ex) {
            looseItems.push(s)
            return
          }
          if (!groupMap[ex._id]) {
            groupMap[ex._id] = { exam: ex, items: [] }
            orderedKeys.push(ex._id)
          }
          groupMap[ex._id].items.push(s)
        })
        // 确保没有 subjects 的 exam 也展示（方便新建第一道 subject）
        exams.forEach(e => {
          if (!groupMap[e._id]) {
            groupMap[e._id] = { exam: e, items: [] }
            orderedKeys.push(e._id)
          }
        })

        const groups = orderedKeys.map(k => groupMap[k])
        this.setData({ loading: false, groups, looseItems })
      })
      .catch(err => {
        console.error(err)
        wx.showToast({ icon: 'none', title: '网络异常' })
        this.setData({ loading: false })
      })
  },

  onCreate() {
    wx.navigateTo({ url: '/pages/hr/subjectEdit/index' })
  },

  onEdit(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/hr/subjectEdit/index?id=' + encodeURIComponent(id) })
  },

  onQuestions(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || ''
    wx.navigateTo({
      url: '/pages/hr/questions/index?examid=' + encodeURIComponent(id) + '&name=' + encodeURIComponent(name)
    })
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || id
    const total = Number(e.currentTarget.dataset.total) || 0
    const tail = total > 0 ? `\n（题库中现有 ${total} 道题目将一同删除，不可恢复）` : ''
    wx.showModal({
      title: '删除题库',
      content: `确定删除「${name}」？${tail}`,
      confirmText: '删除',
      confirmColor: '#f56c6c',
      success: r => {
        if (r.confirm) this.doDelete(id)
      }
    })
  },

  doDelete(id) {
    wx.showLoading({ title: '删除中…', mask: true })
    wx.cloud.callFunction({ name: 'hrDeleteSubject', data: { _id: id } })
      .then(res => {
        wx.hideLoading()
        const r = res.result || {}
        if (r.ok) {
          wx.showToast({ icon: 'success', title: '已删除' })
          this.loadList()
          return
        }
        if (r.code === 'BLOCKED_BY_ASSESSMENT') {
          const detail = Array.isArray(r.detail) ? r.detail : []
          wx.showModal({
            title: '无法删除',
            content: '该题库正被以下考试引用：\n' + detail.map(d => '· ' + (d.name || d._id)).join('\n'),
            showCancel: false
          })
          return
        }
        wx.showToast({ icon: 'none', title: r.message || r.msg || '删除失败' })
      })
      .catch(err => {
        wx.hideLoading()
        console.error(err)
        wx.showToast({ icon: 'none', title: '网络异常' })
      })
  },

  onPullDownRefresh() {
    this.loadList()
    wx.stopPullDownRefresh()
  }
})
