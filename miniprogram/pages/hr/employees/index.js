const app = getApp()

Page({
  data: {
    loading: true,
    list: [],
    total: 0,
    me: null,
    busyId: '',
    importing: false
  },

  onShow() {
    app.guardAuth().then(emp => {
      if (!emp) return
      if (emp.role !== 'hr' && emp.role !== 'admin') {
        wx.showToast({ icon: 'none', title: '无权访问' })
        setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 800)
        return
      }
      this.setData({ me: emp })
      this.loadList()
    })
  },

  loadList() {
    this.setData({ loading: true })
    wx.cloud.callFunction({ name: 'hrListEmployees' })
      .then(res => {
        const r = res.result || {}
        if (!r.ok) {
          wx.showToast({ icon: 'none', title: r.msg || '加载失败' })
          this.setData({ loading: false })
          return
        }
        this.setData({
          loading: false,
          list: r.list || [],
          total: r.total || 0
        })
      })
      .catch(err => {
        console.error(err)
        wx.showToast({ icon: 'none', title: '网络异常' })
        this.setData({ loading: false })
      })
  },

  // 编辑员工：跳编辑页
  onEdit(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/hr/employeeEdit/index?id=' + id })
  },

  // 新建员工
  onCreate() {
    wx.navigateTo({ url: '/pages/hr/employeeEdit/index?create=1' })
  },

  // 删除员工：二次确认 + 调云函数
  onDelete(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || ''
    const item = this.data.list.find(x => x._id === id)
    if (!item) return
    if (item.role === 'admin') {
      wx.showToast({ icon: 'none', title: '超管账号请在控制台删除' })
      return
    }
    if (this.data.me && item.openid === this.data.me.openid) {
      wx.showToast({ icon: 'none', title: '不能删除自己' })
      return
    }
    wx.showModal({
      title: '删除员工',
      content: `确定删除「${name}」吗？\n\n删除后该账号将无法登录小程序，但历史成绩和答卷记录会保留。如需恢复，需重新录入白名单。`,
      confirmText: '删除',
      confirmColor: '#c0392b',
      success: r => {
        if (!r.confirm) return
        this.doDelete(id, name)
      }
    })
  },

  doDelete(id, name) {
    this.setData({ busyId: id })
    wx.cloud.callFunction({ name: 'hrDeleteEmployee', data: { _id: id } })
      .then(res => {
        this.setData({ busyId: '' })
        const r = res.result || {}
        if (r.ok) {
          wx.showToast({ icon: 'success', title: '已删除' })
          this.loadList()
        } else {
          const msgMap = {
            FORBIDDEN: '无 HR 权限',
            SELF_LOCK: '不能删除自己',
            NOT_FOUND: '员工不存在',
            PROTECTED: '超管账号请在控制台删除'
          }
          wx.showToast({ icon: 'none', title: msgMap[r.code] || r.message || '删除失败' })
        }
      })
      .catch(err => {
        console.error('[delete]', err)
        this.setData({ busyId: '' })
        wx.showToast({ icon: 'none', title: '网络异常' })
      })
  },

  // 批量导入员工白名单
  onImport() {
    if (this.data.importing) return
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv'],
      success: res => {
        const file = res.tempFiles[0]
        if (!file) return
        if (file.size > 10 * 1024 * 1024) {
          wx.showToast({ icon: 'none', title: '文件过大（>10MB）' })
          return
        }
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: r => {
            this.doImport(r.data)
          },
          fail: () => {
            wx.showToast({ icon: 'none', title: '文件读取失败' })
          }
        })
      }
    })
  },

  doImport(csv) {
    this.setData({ importing: true })
    wx.showLoading({ title: '导入中…', mask: true })
    wx.cloud.callFunction({
      name: 'hrImportEmployees',
      data: { csv }
    }).then(res => {
      wx.hideLoading()
      this.setData({ importing: false })
      const r = res.result || {}
      if (!r.ok) {
        wx.showModal({ title: '导入失败', content: r.message || '未知错误', showCancel: false })
        return
      }
      let content = `成功：${r.inserted} 条\n跳过：${r.skipped} 条（已存在）`
      if (r.errors && r.errors.length > 0) {
        const errLines = r.errors.slice(0, 10).map(e => `第 ${e.row} 行：${e.msg}`).join('\n')
        content += `\n失败：${r.errors.length} 条\n${errLines}`
        if (r.errors.length > 10) content += `\n... 等 ${r.errors.length - 10} 条`
      }
      wx.showModal({
        title: '导入完成',
        content,
        showCancel: false,
        success: () => this.loadList()
      })
    }).catch(err => {
      console.error('[import]', err)
      wx.hideLoading()
      this.setData({ importing: false })
      wx.showToast({ icon: 'none', title: '网络异常' })
    })
  },

  onPullDownRefresh() {
    this.loadList()
    wx.stopPullDownRefresh()
  }
})
