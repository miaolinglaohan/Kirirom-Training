// pages/simple/index.js
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
    openid: '',
    idx: 0,
    buttontext: '下一个',
    score: 0,
    score_arr: [],
    code_arr: [],
    total: 0,
    options: [],
    // 题型筛选
    tabs: TYPE_TABS,
    activeTab: '',
    allQuestions: [],       // 全部题目（筛选前的原始数据）
    // 回顾栏
    finished: false,        // 是否已结束（显示回顾栏）
    showReview: false,      // 是否展开题号网格
    rightNum: 0,
    errNum: 0,
    answeredNum: 0,         // 已答题数（实时更新）
    // 收藏
    favorited: false,       // 当前题是否已收藏
    // 答题反馈
    answerState: null,      // null | { correct:[], selected:[], isRight }
    correctText: '',        // 正确答案文字，如 "AB"
    // 刷题模式：'order' 顺序刷全部 | '' 随机刷（最多50题）
    mode: ''
  },

  onLoad: function (options) {
    let id = options.id
    if (!id) {
      wx.showToast({ icon: 'none', title: '缺少参数' })
      return
    }
    this.setData({ id, mode: options.mode || '' })
    this.loadQuestions(id)
  },

  onUnload() {
    if (this._autoNextTimer) {
      clearTimeout(this._autoNextTimer)
      this._autoNextTimer = null
    }
  },

  // 加载题目
  loadQuestions: function(id) {
    const db = wx.cloud.database()
    db.collection('questions').where({ examid: id }).get().then(res => {
      let questions = res.data
      if (questions && questions.length > 0) {
        this.loadSubjectMeta(id)
        this._storeAndFilter(questions)
        return
      }
      // id 可能是 exam._id，中转查 subjects
      return db.collection('subjects').where({ pid: id }).get()
    }).then(res => {
      if (!res) return
      let subjects = res.data
      if (!subjects || subjects.length === 0) {
        wx.showToast({ icon: 'none', title: '该题库下暂无题目' })
        return
      }
      this.loadSubjectMeta(subjects[0]._id)
      return db.collection('questions').where({ examid: subjects[0]._id }).get()
    }).then(res => {
      if (!res) return
      let questions = res.data
      if (!questions || questions.length === 0) {
        wx.showToast({ icon: 'none', title: '该题库下暂无题目' })
        return
      }
      this._storeAndFilter(questions)
    }).catch(err => {
      wx.showToast({ icon: 'none', title: '加载题目失败' })
      console.error('[simple] 查询失败: ', err)
    })
  },

  loadSubjectMeta(id) {
    const db = wx.cloud.database()
    db.collection('subjects').doc(id).get({
      success: res => {
        const s = res.data || {}
        this.setData({ subjectName: s.name || '', subjectId: s._id || id })
      },
      fail: () => {
        this.setData({ subjectName: '', subjectId: id })
      }
    })
  },

  // 存原始题目，然后按当前 tab 筛选
  _storeAndFilter(questions) {
    this.setData({ allQuestions: questions })
    this.applyFilter()
  },

  // 题型筛选
  onTabChange(e) {
    const key = e.currentTarget.dataset.key || ''
    if (key === this.data.activeTab) return
    this.setData({ activeTab: key })
    this.applyFilter()
  },

  applyFilter() {
    const tab = this.data.activeTab
    let questions = this.data.allQuestions
    if (tab) {
      questions = questions.filter(q => q.typecode === tab)
    }
    this._startQuiz(questions)
  },

  _startQuiz: function(questions) {
    let arr = questions.map(q => q._id)
    let total = arr.length
    // 随机模式：打乱 + 最多50题；顺序模式：保持原顺序、刷全部
    if (this.data.mode !== 'order') {
      arr.sort(() => Math.random() - 0.5)
      if (total > 50) { arr = arr.slice(0, 50); total = 50 }
    }
    if (total === 0) {
      wx.showToast({ icon: 'none', title: '该题型暂无题目' })
      this.setData({ arr: [], total: 0, question: null, finished: false })
      return
    }
    let score_arr = new Array(total).fill(0)
    let code_arr = new Array(total).fill('M')
    this.setData({
      arr, total, score_arr, code_arr,
      idx: 0, buttontext: '下一个', score: 0,
      finished: false, showReview: false, rightNum: 0, errNum: 0, answeredNum: 0,
      answerState: null, correctText: ''
    }, () => {
      this.getQuestion(arr[0])
    })
  },

  // 实时刷新底部统计：已答 / 正确 / 错误
  _updateStats() {
    const { code_arr, score_arr } = this.data
    let answered = 0, right = 0, err = 0
    for (let i = 0; i < code_arr.length; i++) {
      if (code_arr[i] !== 'M') {
        answered++
        if (score_arr[i] === 1) right++
        else err++
      }
    }
    this.setData({ answeredNum: answered, rightNum: right, errNum: err })
  },

  // 构建单题反馈：给每个选项打 mark，并算出正确答案文字
  // mark: 'ok' 选中的正确项(绿✓) | 'err' 选中的错误项(红✗) | 'miss' 漏选的正确项(蓝✓，仅多选) | ''
  _buildFeedback(question, selectedCodes, isMultiple) {
    const opts = (question.options || []).map(o => ({
      code: o.code,
      content: o.content,
      checked: selectedCodes.indexOf(o.code) >= 0,
      value: o.value,
      mark: ''
    }))
    const correctCodes = opts.filter(o => parseInt(o.value) === 1).map(o => o.code)
    opts.forEach(o => {
      const isCorrect = correctCodes.indexOf(o.code) >= 0
      const isSelected = selectedCodes.indexOf(o.code) >= 0
      if (isCorrect && isSelected) {
        o.mark = 'ok'
      } else if (!isCorrect && isSelected) {
        o.mark = 'err'
      } else if (isCorrect && !isSelected && isMultiple) {
        o.mark = 'miss'   // 漏选的正确项（多选才有）
      } else if (isCorrect && !isSelected && !isMultiple) {
        o.mark = 'ok'     // 单选/判断选错时，正确答案也显示绿✓
      }
    })
    const correctText = correctCodes.join('')
    return { options: opts, correctText, correctCodes }
  },

  radioChange: function(e) {
    if (this.data.finished || this.data.answerState) return
    let code = e.detail.value
    let { score_arr, code_arr, idx, question, total } = this.data
    let opt = (question.options || []).find(o => o.code === code)
    let point = (opt && parseInt(opt.value) === 1) ? 1 : 0
    score_arr[idx] = point
    code_arr[idx] = code
    // 构建反馈（单选/判断：非多选）
    const fb = this._buildFeedback(question, [code], false)
    this.setData({
      score_arr, code_arr,
      score: score_arr.reduce((x,y) => x + y, 0),
      options: fb.options,
      correctText: fb.correctText,
      answerState: { correct: fb.correctCodes, selected: [code], isRight: point === 1 }
    })
    this._updateStats()
    // 答对自动跳转（800ms 让用户看到绿色反馈）；答错停留，手动点"下一题"
    if (point === 1 && idx < total - 1) {
      this._autoNextTimer = setTimeout(() => this._gotoNext(), 800)
    }
    if (point === 1 && idx >= total - 1) {
      this._autoNextTimer = setTimeout(() => this._finish(), 800)
    }
  },

  checkboxChange: function(e) {
    if (this.data.finished) return
    let codes = e.detail.value || []
    let { score_arr, code_arr, idx, question } = this.data
    let correctCodes = (question.options || [])
      .filter(o => parseInt(o.value) === 1)
      .map(o => o.code).sort()
    let userSorted = codes.slice().sort()
    let perfect = correctCodes.length === userSorted.length
      && correctCodes.every((c, i) => c === userSorted[i])

    let point = 0
    if (perfect) {
      point = 1
    } else if (userSorted.length === 1) {
      point = 0
    } else if (userSorted.length > 1 && userSorted.every(c => correctCodes.includes(c))) {
      point = 0.5
    }

    score_arr[idx] = point
    code_arr[idx] = codes.join('')
    // 多选题不在这里设answerState（会锁死后续勾选），点下一题时才显示反馈
    this.setData({
      score_arr, code_arr,
      score: score_arr.reduce((x,y) => x + y, 0)
    })
    this._updateStats()
  },

  onNextTap: function() {
    let _this = this
    let { score_arr, code_arr, idx, question, total } = this.data

    // 已结束（回顾模式）：下一题按钮变成翻页；末题无下一题则不响应
    if (this.data.finished) {
      if (this.data.idx >= this.data.total - 1) return
      this._gotoNext()
      return
    }

    // 多选题：点"下一题"才显示反馈，再点一次才手动跳转
    if (question && question.typecode === '02' && code_arr[idx] !== 'M') {
      if (!this.data.answerState) {
        // 首次点：显示反馈
        let selCodes = String(code_arr[idx]).split('').filter(Boolean)
        const fb = this._buildFeedback(question, selCodes, true)
        const isRight = score_arr[idx] === 1
        this.setData({
          options: fb.options,
          correctText: fb.correctText,
          answerState: { correct: fb.correctCodes, selected: selCodes, isRight }
        })
        // 全对：800ms 后自动跳；不全对（错选/漏选）：停留，等用户再点手动跳
        if (isRight) {
          if (idx < total - 1) {
            this._autoNextTimer = setTimeout(() => _this._gotoNext(), 800)
          } else {
            this._autoNextTimer = setTimeout(() => _this._finish(), 800)
          }
        }
        return
      }
      // 已显示反馈（停留中）：手动跳转
      _this._gotoNext()
      return
    }

    // 单选/判断已答：直接跳
    if (code_arr[idx] != 'M') {
      _this._gotoNext()
      return
    }

    if (score_arr[idx] == 0) {
      this.add(question)
    }
    if (code_arr[idx] == 'M') {
      wx.showActionSheet({
        itemList: ['放弃该题', '容我三思'],
        success (res) {
          if (res.tapIndex == 1) { return }
          else { _this._gotoNext() }
        },
        fail (res) { console.log(res.errMsg) }
      })
    } else {
      _this._gotoNext()
    }
  },

  // 翻到下一题（或结束）
  _gotoNext: function() {
    let { arr, idx, total } = this.data
    let buttontext = this.data.buttontext
    idx++
    if (idx == total - 1) {
      buttontext = '提交'
    }
    if (idx >= total) {
      // 刷题结束：不跳成绩页，显示回顾栏
      this._finish()
      return
    }
    this.setData({ idx, buttontext, answerState: null, correctText: '' })
    this.getQuestion(arr[idx], { replay: true })
  },

  // 翻到上一题
  _gotoPrev() {
    let { arr, idx } = this.data
    if (idx <= 0) return
    idx--
    this.setData({ idx, buttontext: '下一个', answerState: null, correctText: '' })
    this.getQuestion(arr[idx], { replay: true })
  },

  // 上一题按钮（首题置灰，由 wxml btn-disabled 控制；此处兜底拦截）
  onPrevTap: function() {
    if (this.data.idx <= 0) return
    this._gotoPrev()
  },

  // ── 左右滑动切题 ──
  onTouchStart(e) {
    const t = e.touches[0]
    this._touchX = t.clientX
    this._touchY = t.clientY
    // 用户手动滑动时取消 auto-advance
    if (this._autoNextTimer) {
      clearTimeout(this._autoNextTimer)
      this._autoNextTimer = null
    }
  },

  onTouchEnd(e) {
    if (this._touchX == null) return
    const t = e.changedTouches[0]
    const dx = t.clientX - this._touchX
    const dy = t.clientY - this._touchY
    this._touchX = null
    // 水平位移 > 50 且大于垂直位移 → 判定为滑动
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) this._gotoNext()      // 左滑 → 下一题
      else this._gotoPrev()              // 右滑 → 上一题
    }
  },

  // 刷题结束
  _finish: function() {
    if (this.data.finished) return   // 防重入
    let { total } = this.data
    this.setData({
      finished: true,
      showReview: false,
      buttontext: '下一题',  // 回顾态可继续翻页，不显示灰底"已完成"
      idx: total - 1         // 停在最后一题
    })
    this._updateStats()   // 结束时同步刷新一次统计
    // 错题批量写入 historys
    this._saveErrorsToHistory()
    wx.showToast({ icon: 'success', title: '刷题完成' })
  },

  // 错题批量写入 historys（与正式考试/模考错题本同源）
  _saveErrorsToHistory: function() {
    const { arr, score_arr, code_arr, allQuestions, id } = this.data
    const openid = app.globalData.openid || ''
    if (!openid) return

    // 收集错题
    const errors = []
    for (let i = 0; i < arr.length; i++) {
      if (score_arr[i] === 0 && code_arr[i] !== 'M') {
        // 找到原始题目对象
        const q = allQuestions.find(x => x._id === arr[i])
        if (q) {
          // 解析用户答案
          let userAnswers = {}
          const userCodes = String(code_arr[i]).split('')
          userCodes.forEach(c => { userAnswers[c] = true })
          // 解析正确答案
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
    }

    if (errors.length === 0) return

    // 写入 historys 一条练习记录
    const db = wx.cloud.database()
    const time = util.formatTime(new Date(Date.now()))
    db.collection('historys').add({
      data: {
        _openid: openid,
        exam: '练习刷题',
        subject: { _id: this.data.subjectId || id, name: this.data.subjectName || '随机刷题' },
        question: JSON.stringify({ id: id, type: 'simple' }),
        createTime: time,
        createTimeMs: Date.now(),
        displayName: (this.data.subjectName || '题库') + '刷题',
        practiceSubjectId: this.data.subjectId || id,
        practiceSubjectName: this.data.subjectName || '',
        isMock: true,
        isPractice: true,          // 标记为练习记录
        total: arr.length,
        rightNum: this.data.rightNum,
        score: this.data.rightNum,
        fullScore: arr.length,
        errors  // 错题数组
      }
    }).then(() => {
      console.log('[simple] 错题已写入 historys')
    }).catch(err => {
      console.error('[simple] 写入错题失败', err)
    })
  },

  // 回顾栏：展开/收起题号网格
  onToggleReview: function() {
    this.setData({ showReview: !this.data.showReview })
  },

  // 回顾栏：点击题号跳转到该题（重建当时作答反馈）
  onReviewJump: function(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const { arr } = this.data
    if (idx < 0 || idx >= arr.length) return
    this.setData({ idx, showReview: false })
    this.getQuestion(arr[idx], { replay: true })
  },

  // 保留旧 add 方法（向后兼容，但新逻辑用 _saveErrorsToHistory）
  add: function(question) {
    // 旧逻辑往 record 集合写，但依赖 exam/subject 变量可能未加载
    // 新逻辑改为结束时统一写 historys，这里保留空实现避免报错
  },

  // 加载题目；opts.replay=true 时用 code_arr 重建当时作答的反馈（回顾用）
  getQuestion: function(_id, opts) {
    opts = opts || {}
    const db = wx.cloud.database()
    db.collection('questions').doc(_id).get({
      success: res => {
        let question = res.data
        const setDataObj = {
          question: question,
          options: question.options
        }
        // 回顾已答题：重建反馈，显示当时所选 + 正确答案
        if (opts.replay) {
          const { code_arr, idx, score_arr } = this.data
          const saved = code_arr[idx]
          if (saved && saved !== 'M') {
            const selCodes = String(saved).split('').filter(Boolean)
            const isMultiple = question.typecode === '02'
            const fb = this._buildFeedback(question, selCodes, isMultiple)
            setDataObj.options = fb.options
            setDataObj.correctText = fb.correctText
            setDataObj.answerState = {
              correct: fb.correctCodes,
              selected: selCodes,
              isRight: score_arr[idx] === 1
            }
          } else {
            // 未答题：清空反馈，允许当场补答
            setDataObj.answerState = null
            setDataObj.correctText = ''
          }
        }
        this.setData(setDataObj)
        // 检查当前题是否已收藏
        this.checkFavorite(_id)
      },
      fail: err => {
        wx.showToast({ icon: 'none', title: '查询记录失败' })
        console.error('[simple] 查询失败: ', err)
      }
    })
  },

  // —— 收藏功能 ——
  checkFavorite(qid) {
    const openid = app.globalData.openid || ''
    if (!openid) { this.setData({ favorited: false }); return }
    const db = wx.cloud.database()
    db.collection('notes')
      .where({ _openid: openid, qid: qid })
      .count({
        success: res => {
          this.setData({ favorited: res.total > 0 })
        },
        fail: () => {
          this.setData({ favorited: false })
        }
      })
  },

  onToggleFavorite() {
    const q = this.data.question
    if (!q || !q._id) return
    if (this.data.favorited) {
      // 取消收藏
      this._removeFavorite(q._id)
    } else {
      // 加入收藏
      this._addFavorite(q)
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
      this.setData({ favorited: true })
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
          this.setData({ favorited: false })
          return null
        }
        // 删除第一条（去重情况下应该只有一条）
        return db.collection('notes').doc(res.data[0]._id).remove()
      })
      .then(r => {
        if (r) {
          this.setData({ favorited: false })
          wx.showToast({ icon: 'success', title: '已取消' })
        }
      })
      .catch(err => {
        console.error('[favorite] remove', err)
        wx.showToast({ icon: 'none', title: '取消失败' })
      })
  }
})
