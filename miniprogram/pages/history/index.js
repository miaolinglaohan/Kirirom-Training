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
    const _ = db.command
    // "我的考试记录"只展示正式考——过滤掉 isMock:true（模考错题进了错题本，但不污染考试记录列表）
    // 兼容旧记录（无 isMock 字段）：用 neq(true) 把它们也保留进来
    db.collection('historys').where({
      _openid: openid,
      isMock: _.neq(true)
    }).orderBy('createTime', 'desc').get({
      success: res => {
        const arrayObject = res.data || []
        const items = arrayObject.slice(0, 5).map(item => {
          if (item.createTime) {
            item.createTime = item.createTime.substr(0, 10)
          }
          // Phase 3：score / fullScore 派生显示字段；旧记录回退 rightNum / 题数
          const total = item.total || (Array.isArray(item.items) ? item.items.length : 0)
          const hasFull = typeof item.fullScore === 'number' && item.fullScore > 0
          const score = typeof item.score === 'number' ? item.score : (item.rightNum || 0)
          const fullScore = hasFull ? item.fullScore : total
          item._scoreDisplay = score + '/' + fullScore + ' 分'
          item._right = item.rightNum || 0
          item._total = total
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
