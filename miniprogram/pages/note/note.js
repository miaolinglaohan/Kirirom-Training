// pages/note/note.js
const app = getApp()

Page({
  data: {
    openid: '',
    notes: [],       // 收藏列表
    idx: 0,
    length: 0,
    question: {},
    options: [],
    loading: true
  },

  onLoad() {
    this.loadNotes()
  },

  loadNotes() {
    this.setData({ loading: true })
    const db = wx.cloud.database()
    db.collection('notes')
      .where({ _openid: app.globalData.openid || '' })
      .orderBy('createTime', 'desc')
      .limit(100)
      .get()
      .then(res => {
        const notes = res.data || []
        this.setData({
          notes,
          length: notes.length,
          loading: false,
          idx: 0
        })
        if (notes.length > 0) {
          this.showNote(0)
        }
      })
      .catch(err => {
        console.error('[note] load', err)
        this.setData({ loading: false })
        wx.showToast({ icon: 'none', title: '加载失败' })
      })
  },

  showNote(idx) {
    const note = this.data.notes[idx]
    if (!note) return
    this.setData({
      question: {
        title: note.title,
        typename: note.typename
      },
      options: note.options || []
    })
  },

  selectOption(e) {
    // 收藏夹只读，不处理选择
  },

  doNext() {
    let idx = this.data.idx + 1
    if (idx >= this.data.length) {
      wx.showToast({ icon: 'none', title: '已是最后一题' })
      return
    }
    this.setData({ idx })
    this.showNote(idx)
  }
})
