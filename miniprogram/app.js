// app.js
//
// 启动入口：
//   1. 初始化云开发
//   2. 调用 whoAmI 拿到当前微信号的身份状态，存入 globalData
//   3. 提供 guardAuth() 供 tabBar 页面在 onShow 调用做身份门禁
//   4. 提供 refreshAuth() 供 HR 创建员工后强制重新拉取身份

App({
    globalData: {
      openid: '',
      employee: null,
      userStatus: 'pending',
      authReadyPromise: null
    },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }
    wx.cloud.init({
      env: 'cloud1-d5gievact76bc75a4',
      traceUser: true
    })
    this.globalData.authReadyPromise = this._fetchAuth()
  },

  // 实际调云函数。不直接暴露给页面调用。
  _fetchAuth() {
    return new Promise(resolve => {
      wx.cloud.callFunction({
        name: 'whoAmI',
        data: {},
        success: res => {
          const r = (res && res.result) || {}
          this.globalData.openid = r.openid || ''
          this.globalData.employee = r.employee || null
          this.globalData.userStatus = r.status || 'error'
          console.log('[app] whoAmI =>', r)
          resolve(r)
        },
        fail: err => {
          console.error('[app] whoAmI 调用失败', err)
          this.globalData.userStatus = 'error'
          resolve({ status: 'error', message: (err && err.errMsg) || String(err) })
        }
      })
    })
  },

  // tabBar 页面 onShow 时调用：返回一个 Promise<employee | null>
  //   - 已注册且启用 → resolve(employee)
  //   - 未注册 / 已停用 → 自动 reLaunch 到未注册提示页，并 resolve(null)
  //   - 网络异常 → 显示 toast，resolve(null)
  guardAuth() {
    return this.globalData.authReadyPromise.then(r => {
      const status = (r && r.status) || this.globalData.userStatus
      if (status === 'active') {
        return r.employee || this.globalData.employee
      }
      if (status === 'not_registered') {
        wx.reLaunch({ url: '/pages/pending/index?status=not_registered' })
        return null
      }
      if (status === 'disabled') {
        wx.reLaunch({ url: '/pages/pending/index?status=disabled' })
        return null
      }
      // error 或其它兜底
      wx.showToast({ icon: 'none', title: '身份校验失败，请下拉刷新重试' })
      return null
    })
  },

  // HR 创建员工后调用，强制重新拉一次 whoAmI
  refreshAuth() {
    this.globalData.authReadyPromise = this._fetchAuth()
    return this.globalData.authReadyPromise
  }
})
