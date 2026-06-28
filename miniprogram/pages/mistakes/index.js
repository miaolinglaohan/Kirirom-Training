// pages/mistakes/index.js
//
// 我的错题页：聚合最近若干次 historys 里答错的题，供员工复习。
// 列表项：题干摘要 + 来源考试 + 您选/正确 简略。点击跳到对应 review 页那一题。

const app = getApp()

Page({
  data: {
    loading: true,
    list: [],          // [{historyId, idx, qtitle, source, dateText, userText, officialText}]
    emptyTip: ''
  },

  onShow() {
    app.guardAuth().then(emp => {
      if (!emp) return
      this.loadMistakes()
    })
  },

  loadMistakes() {
    const openid = app.globalData.openid
    if (!openid) {
      this.setData({ loading: false, emptyTip: '未登录' })
      return
    }
    const db = wx.cloud.database()
    db.collection('historys')
      .where({ _openid: openid })
      .orderBy('createTime', 'desc')
      .limit(20)
      .get()
      .then(res => {
        const all = res.data || []
        const list = []
        all.forEach(h => {
          const items = Array.isArray(h.items) ? h.items : []
          const scoreArr = Array.isArray(h.score_arr) ? h.score_arr : []
          const userAnswers = h.userAnswers || {}
          // 构造 qid → correctCodes
          const officialMap = {}
          ;(h.answersOfficial || []).forEach(a => {
            officialMap[a.qid] = (a.correctCodes || []).map(c => String(c).toUpperCase())
          })
          items.forEach((q, idx) => {
            if (!q || typeof q !== 'object' || !q.title) return
            const isRight = scoreArr[idx] === 1 || scoreArr[idx] === true
            if (isRight) return
            const userCodes = (userAnswers[q._id] || []).map(c => String(c).toUpperCase()).sort()
            const officialCodes = (officialMap[q._id] || []).slice().sort()
            list.push({
              historyId: h._id,
              idx,
              qtitle: q.title,
              source: (h.subject && h.subject.name) || '考试',
              dateText: h.createTime || '',
              userText: userCodes.length ? userCodes.join('、') : '未作答',
              officialText: officialCodes.length ? officialCodes.join('、') : '-'
            })
          })
        })
        this.setData({
          loading: false,
          list,
          emptyTip: list.length === 0 ? '太棒了，最近没有错题 🎉' : ''
        })
      })
      .catch(err => {
        console.error('[mistakes] 查询失败', err)
        this.setData({ loading: false, emptyTip: '加载失败，请稍后重试' })
      })
  },

  toReview(e) {
    const { id, idx } = e.currentTarget.dataset
    wx.navigateTo({
      url: '/pages/review/review?id=' + id + '&idx=' + idx
    })
  }
})
