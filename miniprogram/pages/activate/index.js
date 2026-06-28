// pages/activate/index.js
const app = getApp()

// 必须和 cloudfunctions/activate/index.js 的 VALID_DEPTS 保持一致
const DEPTS = [
  '项目部',
  '运行检修部',
  '综合管理部',
  '枢纽管理部',
  '安全技术部',
  '财务资金部'
]

Page({
  data: {
    name: '',
    deptIndex: -1,        // -1 表示未选择
    deptList: DEPTS,
    submitting: false,
    reasonText: ''        // 顶部黄色提示条文案，如「已停用」
  },

  onLoad(opts) {
    if (opts && opts.reason === 'disabled') {
      this.setData({
        reasonText: '⚠️ 您的账号已被 HR 停用。如需恢复请联系管理员。'
      })
    }
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value })
  },

  onDeptChange(e) {
    this.setData({ deptIndex: Number(e.detail.value) })
  },

  onSubmit() {
    if (this.data.submitting) return

    const name = (this.data.name || '').trim()
    const idx = this.data.deptIndex

    if (!name) {
      wx.showToast({ icon: 'none', title: '请输入姓名' })
      return
    }
    if (idx < 0) {
      wx.showToast({ icon: 'none', title: '请选择部门' })
      return
    }
    const dept = this.data.deptList[idx]

    this.setData({ submitting: true })

    wx.cloud.callFunction({
      name: 'activate',
      data: { name, dept }
    }).then(res => {
      const r = (res && res.result) || {}
      if (r.ok) {
        wx.showToast({ title: '激活成功', icon: 'success', duration: 1000 })
        // 重新拉一次身份状态，然后跳首页
        app.refreshAuth().then(() => {
          setTimeout(() => {
            wx.reLaunch({ url: '/pages/home/index' })
          }, 1000)
        })
      } else {
        wx.showModal({
          title: '激活失败',
          content: r.message || '未知错误',
          showCancel: false,
          confirmText: '我知道了'
        })
        this.setData({ submitting: false })
      }
    }).catch(err => {
      console.error('[activate] 调用失败', err)
      wx.showModal({
        title: '网络异常',
        content: (err && err.errMsg) || '请检查网络后重试',
        showCancel: false
      })
      this.setData({ submitting: false })
    })
  }
})
