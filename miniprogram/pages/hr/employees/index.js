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

  onToggleRole(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.list.find(x => x._id === id)
    if (!item) return
    if (item.role === 'admin') {
      wx.showToast({ icon: 'none', title: '超管账号请在控制台调整' })
      return
    }
    if (this.data.me && item.openid === this.data.me.openid) {
      wx.showToast({ icon: 'none', title: '不能修改自己的角色' })
      return
    }
    const nextRole = item.role === 'hr' ? 'employee' : 'hr'
    wx.showModal({
      title: '切换角色',
      content: `将「${item.name}」设为 ${nextRole === 'hr' ? 'HR 管理员' : '普通员工'}？`,
      success: r => {
        if (r.confirm) this.patch(id, { role: nextRole })
      }
    })
  },

  onToggleActive(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.list.find(x => x._id === id)
    if (!item) return
    if (item.role === 'admin') {
      wx.showToast({ icon: 'none', title: '超管账号请在控制台调整' })
      return
    }
    if (this.data.me && item.openid === this.data.me.openid) {
      wx.showToast({ icon: 'none', title: '不能停用自己' })
      return
    }
    const nextActive = !(item.active !== false)
    wx.showModal({
      title: nextActive ? '启用员工' : '停用员工',
      content: `确定${nextActive ? '启用' : '停用'}「${item.name}」？`,
      success: r => {
        if (r.confirm) this.patch(id, { active: nextActive })
      }
    })
  },

  patch(id, patch) {
    this.setData({ busyId: id })
    wx.cloud.callFunction({
      name: 'hrSetEmployee',
      data: { id, patch }
    }).then(res => {
      const r = res.result || {}
      this.setData({ busyId: '' })
      if (!r.ok) {
        const msgMap = {
          FORBIDDEN: '无权操作',
          SELF_LOCK: '不能修改自己',
          NOT_FOUND: '员工不存在',
          INVALID_PATCH: '参数错误',
          PROTECTED: '超管账号请在控制台调整'
        }
        wx.showToast({ icon: 'none', title: msgMap[r.code] || r.msg || '操作失败' })
        return
      }
      const list = this.data.list.map(x => x._id === id ? Object.assign({}, x, r.updated) : x)
      this.setData({ list })
      wx.showToast({ icon: 'success', title: '已更新' })
    }).catch(err => {
      console.error(err)
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
        // 限制文件大小（10MB）
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
      // 结果统计
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
