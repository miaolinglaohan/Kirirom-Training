// pages/history/index.js
const app = getApp()

Page({
  data: {
    items: []
  },

  onLoad() {
    // 实际加载由 onShow 触发（先过身份守卫）
  },

  onShow() {
    app.guardAuth().then(emp => {
      if (!emp) return
      const openid = app.globalData.openid
      if (openid) {
        this.query(openid)
      }
    })
  },

  query(openid) {
    const db = wx.cloud.database()
    db.collection('historys').where({
      _openid: openid
    }).get({
      success: res => {
        const arrayObject = res.data || []
        const items = arrayObject.slice(0, 5).map(item => {
          if (item.createTime) {
            item.createTime = item.createTime.substr(0, 10)
          }
          return item
        })
        this.setData({ items })
      },
      fail: err => {
        wx.showToast({ icon: 'none', title: '查询记录失败' })
        console.error('[历史] 查询失败：', err)
      }
    })
  },

  toReviewPage(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/review/review?id=' + id })
  },

  toModePage(e) {
    wx.setStorageSync('arr', JSON.parse(e.currentTarget.dataset.questions))
    wx.redirectTo({ url: '/pages/look/index' })
  },

  toAttendPage(e) {
    const id = e.currentTarget.dataset.id
    const title = e.currentTarget.dataset.title
    wx.navigateTo({ url: '/pages/question/index?id=' + id + '&title=' + title })
  }
})
