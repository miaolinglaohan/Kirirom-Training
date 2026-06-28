// pages/profile/index.js
const app = getApp()

Page({
  data: {
    openid: '',
    employee: null,
    isAdmin: false
  },

  onShow() {
    app.guardAuth().then(emp => {
      if (!emp) return  // 已被 reLaunch
      this.setData({
        openid: app.globalData.openid || '',
        employee: emp,
        isAdmin: emp.role === 'admin'
      })
    })
  },

  copyOpenid() {
    if (!this.data.openid) {
      wx.showToast({ icon: 'none', title: '尚未获取到 ID' })
      return
    }
    wx.setClipboardData({
      data: this.data.openid,
      success: () => wx.showToast({ title: '已复制' })
    })
  },

  toAbout() {
    wx.navigateTo({ url: '/pages/about/index' })
  },

  toRule() {
    wx.navigateTo({ url: '/pages/rule/index' })
  },

  toAdminEntry() {
    // Phase 4 才真正生效，先占位
    wx.showToast({ icon: 'none', title: '管理后台入口（待 Phase 4 实现）' })
  }
})
