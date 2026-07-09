// pages/question/index.js
const util = require('../../utils/util.js')
const app = getApp()

const TYPE_TABS = [
  { key: '',   label: '全部' },
  { key: '01', label: '单选' },
  { key: '02', label: '多选' },
  { key: '03', label: '判断' }
]

Page({
  data: {
    idx: 0,
    score: 0,
    score_arr: [],
    code_arr: [],
    total: 0,
    // 题型筛选
    tabs: TYPE_TABS,
    activeTab: '',
    allQuestions: [],
    // 回顾栏
    finished: false,
    showReview: false,
    rightNum: 0,
    errNum: 0,
    // 收藏状态：{ qid: true }
    favMap: {}
  },

  onLoad: function (options) {
    let id = options.id
    if (!id) {
      wx.showToast({ icon: 'none', title: '缺少参数' })
      return
    }
    this.setData({ id })
    this.getQuestions(id)
  },

  getQuestions: function(id) {
    const db = wx.cloud.database()
    db.collection('questions').where({ examid: id }).get({
      success: res => {
        let questions = res.data
        this.setData({ allQuestions: questions })
        this.applyFilter()
      },
      fail: err => {
        wx.showToast({ icon: 'none', title: '查询记录失败' })
        console.error('[question] 查询失败: ', err)
      }
    })
  },

  // 题型筛选
  onTabChange(e) {
    const key = e.currentTarget.dataset.key || ''
    if (key === this.data.activeTab) return
    this.setData({ activeTab: key, finished: false, showReview: false })
    this.applyFilter()
  },

  applyFilter() {
    const tab = this.data.activeTab
    let questions = this.data.allQuestions
    if (tab) {
      questions = questions.filter(q => q.typecode === tab)
    }
    let total = questions.length
    let arr = questions.map(q => q._id)
    let score_arr = new Array(total).fill(0)
    let code_arr = new Array(total).fill('M')
    this.setData({
      questions, total, arr, score_arr, code_arr,
      idx: 0, score: 0, finished: false, showReview: false
    })
    // 批量检查收藏状态
    this._checkFavorites(arr)
  },

  // 批量查询哪些题已收藏
  _checkFavorites(qids) {
    const openid = app.globalData.openid || ''
    if (!openid || qids.length === 0) {
      this.setData({ favMap: {} })
      return
    }
    const db = wx.cloud.database()
    const _ = db.command
    db.collection('notes')
      .where({ _openid: openid, qid: _.in(qids) })
      .field({ qid: true })
      .limit(200)
      .get()
      .then(res => {
        const favMap = {}
        ;(res.data || []).forEach(n => { favMap[n.qid] = true })
        this.setData({ favMap })
      })
      .catch(() => {
        this.setData({ favMap: {} })
      })
  },

  // 收藏/取消收藏
  onToggleFavorite(e) {
    const qid = e.currentTarget.dataset.qid
    if (!qid) return
    const question = this.data.questions.find(q => q._id === qid)
    if (!question) return
    const isFav = this.data.favMap[qid]
    if (isFav) {
      this._removeFavorite(qid)
    } else {
      this._addFavorite(question)
    }
  },

  _addFavorite(question) {
    const openid = app.globalData.openid || ''
    if (!openid) {
      wx.showToast({ icon: 'none', title: '请先登录' })
      return
    }
    const db = wx.cloud.database()
    const time = util.formatTime(new Date(Date.now()))
    db.collection('notes').add({
      data: {
        _openid: openid,
        qid: question._id,
        title: question.title,
        typecode: question.typecode,
        typename: question.typename,
        options: question.options,
        comments: question.comments,
        examid: question.examid,
        createTime: time
      }
    }).then(() => {
      this.setData({ ['favMap.' + question._id]: true })
      wx.showToast({ icon: 'success', title: '已收藏' })
    }).catch(err => {
      console.error('[favorite] add', err)
      wx.showToast({ icon: 'none', title: '收藏失败' })
    })
  },

  _removeFavorite(qid) {
    const openid = app.globalData.openid || ''
    const db = wx.cloud.database()
    db.collection('notes')
      .where({ _openid: openid, qid: qid })
      .get()
      .then(res => {
        if (!res.data || res.data.length === 0) {
          this.setData({ ['favMap.' + qid]: false })
          return null
        }
        return db.collection('notes').doc(res.data[0]._id).remove()
      })
      .then(r => {
        if (r) {
          this.setData({ ['favMap.' + qid]: false })
          wx.showToast({ icon: 'success', title: '已取消' })
        }
      })
      .catch(err => {
        console.error('[favorite] remove', err)
        wx.showToast({ icon: 'none', title: '取消失败' })
      })
  },

  radioChange: function(e) {
    if (this.data.finished) return
    let idx = e.currentTarget.dataset.idx
    let code = e.detail.value
    let score_arr = this.data.score_arr
    let code_arr = this.data.code_arr
    let question = e.currentTarget.dataset.question
    let opt = (question.options || []).find(o => o.code === code)
    let point = (opt && parseInt(opt.value) === 1) ? 1 : 0
    score_arr[idx] = point
    code_arr[idx] = code
    let sum = score_arr.reduce((x,y) => x + y, 0)
    this.setData({ score_arr, code_arr, score: sum })
  },

  checkboxChange: function(e) {
    if (this.data.finished) return
    let idx = e.currentTarget.dataset.idx
    let codes = e.detail.value || []
    let question = e.currentTarget.dataset.question
    let correctCodes = (question.options || [])
      .filter(o => parseInt(o.value) === 1)
      .map(o => o.code).sort()
    let userSorted = codes.slice().sort()
    let right = correctCodes.length === userSorted.length
      && correctCodes.every((c, i) => c === userSorted[i])
    let score_arr = this.data.score_arr
    let code_arr = this.data.code_arr
    score_arr[idx] = right ? 1 : 0
    code_arr[idx] = codes.join('')
    let sum = score_arr.reduce((x,y) => x + y, 0)
    this.setData({ score_arr, code_arr, score: sum })
  },

  // 提交：不跳成绩页，显示回顾栏
  bindSubmitTap: function() {
    let { total, score_arr } = this.data
    let rightNum = score_arr.filter(v => v === 1).length
    let errNum = total - rightNum
    // 检查是否有未答的题
    let unanswered = score_arr.filter((v, i) => this.data.code_arr[i] === 'M').length
    let content = `✔ ${rightNum}  ❌ ${errNum}  /  共 ${total} 题`
    if (unanswered > 0) {
      content += `\n（其中 ${unanswered} 题未作答）`
    }
    this.setData({ finished: true, showReview: false, rightNum, errNum })
    // 错题写入 historys
    this._saveErrorsToHistory()
    wx.showToast({ icon: 'success', title: '已完成' })
  },

  // 错题批量写入 historys
  _saveErrorsToHistory: function() {
    const { questions, score_arr, code_arr, id, total, rightNum } = this.data
    const openid = app.globalData.openid || ''
    if (!openid) return

    const errors = []
    for (let i = 0; i < questions.length; i++) {
      if (score_arr[i] === 0 && code_arr[i] !== 'M') {
        const q = questions[i]
        let userAnswers = {}
        String(code_arr[i]).split('').forEach(c => { userAnswers[c] = true })
        let answersOfficial = {}
        ;(q.options || []).forEach(o => {
          if (parseInt(o.value) === 1) answersOfficial[o.code] = true
        })
        errors.push({
          qid: q._id,
          title: q.title,
          typecode: q.typecode,
          options: q.options,
          userAnswers,
          answersOfficial,
          comments: q.comments
        })
      }
    }

    if (errors.length === 0) return

    const db = wx.cloud.database()
    const time = util.formatTime(new Date(Date.now()))
    db.collection('historys').add({
      data: {
        _openid: openid,
        exam: '练习刷题',
        subject: '顺序练习',
        question: JSON.stringify({ id: id, type: 'question' }),
        createTime: time,
        isMock: true,
        isPractice: true,
        total: total,
        rightNum: rightNum,
        score: rightNum,
        fullScore: total,
        errors
      }
    }).then(() => {
      console.log('[question] 错题已写入 historys')
    }).catch(err => {
      console.error('[question] 写入错题失败', err)
    })
  },

  // 回顾栏
  onToggleReview: function() {
    this.setData({ showReview: !this.data.showReview })
  },

  // 回顾：滚动到指定题
  onReviewJump: function(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    this.setData({ showReview: false })
    // 滚动到对应题目（用 id 定位）
    wx.pageScrollTo({ selector: `.q-item-${idx}`, duration: 300 })
  }
})
