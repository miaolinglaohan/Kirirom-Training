// pages/pending/index.js
//
// 未注册提示页：新用户首次打开小程序时，whoAmI 返回 not_registered 或 disabled，
// 自动跳转到此页。显示 openid 供用户复制发给 HR，锁定所有其他功能。
// HR 在后台创建员工并绑定 openid 后，用户重新打开即可自动登录。

const app = getApp()

Page({
  data: {
    openid: '',
    status: '',          // not_registered | disabled
    message: '',
    tips: ''
  },

  onLoad(options) {
    const status = (options && options.status) || 'not_registered'
    const message = (options && options.message) || ''
    const openid = app.globalData.openid || '加载中...'

    let tips = '请将上方用户码发送给管理员，由管理员在后台为您创建账号后即可登录。'
    if (status === 'disabled') {
      tips = '您的账号已被管理员停用，如需恢复请联系管理员。'
    }

    this.setData({ openid, status, message, tips })
  },

  // 复制 openid
  onCopyOpenid() {
    if (!this.data.openid || this.data.openid === '加载中...') return
    wx.setClipboardData({
      data: this.data.openid,
      success: () => {
        wx.showToast({ icon: 'success', title: '已复制' })
      }
    })
  },

  // 刷新状态：重新调 whoAmI，如果 HR 已创建则自动登录
  onRefresh() {
    wx.showLoading({ title: '检查中…', mask: true })
    app.refreshAuth().then(r => {
      wx.hideLoading()
      const status = (r && r.status)
      if (status === 'active') {
        wx.reLaunch({ url: '/pages/home/index' })
      } else if (status === 'not_registered') {
        this.setData({ tips: '尚未注册，请将用户码发给管理员。' })
        wx.showToast({ icon: 'none', title: '尚未注册' })
      } else if (status === 'disabled') {
        this.setData({ tips: '账号已被停用，请联系管理员。' })
        wx.showToast({ icon: 'none', title: '账号已停用' })
      } else {
        wx.showToast({ icon: 'none', title: '检查失败，请稍后下拉刷新' })
      }
    })
  }
})
