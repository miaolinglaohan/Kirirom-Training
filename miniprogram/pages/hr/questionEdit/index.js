const app = getApp()

const TYPE_KEYS  = ['01', '02', '03']
const TYPE_LABELS = ['单选题', '多选题', '判断题']
const CODES = ['A','B','C','D','E','F','G','H']  // 最多 8 个选项
const MAX_OPTIONS = 8
const MIN_OPTIONS = 2

function makeEmptyOption(code) {
  return { code, content: '', value: '0' }
}
function defaultOptionsForSingleMulti() {
  return [
    makeEmptyOption('A'),
    makeEmptyOption('B'),
    makeEmptyOption('C'),
    makeEmptyOption('D')
  ]
}
function judgeOptions() {
  return [
    { code: 'A', content: '正确', value: '0' },
    { code: 'B', content: '错误', value: '0' }
  ]
}

Page({
  data: {
    examid: '',
    qid: '',
    isCreate: true,
    loading: false,
    saving: false,

    typeKeys: TYPE_KEYS,
    typeLabels: TYPE_LABELS,
    typeIndex: 0,
    typecode: '01',
    isJudge: false,

    title: '',
    comments: '',
    options: defaultOptionsForSingleMulti()
  },

  onLoad(opts) {
    const examid = opts && opts.examid ? decodeURIComponent(opts.examid) : ''
    const qid = opts && opts.id ? decodeURIComponent(opts.id) : ''
    const isCreate = !qid
    this.setData({
      examid,
      qid,
      isCreate
    })
    wx.setNavigationBarTitle({ title: isCreate ? '新建题目' : '编辑题目' })

    if (!examid) {
      wx.showToast({ icon: 'none', title: '参数缺失' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    if (!isCreate) this.loadDetail()
  },

  onShow() {
    app.guardAuth().then(emp => {
      if (!emp) return
      if (emp.role !== 'hr' && emp.role !== 'admin') {
        wx.showToast({ icon: 'none', title: '无权访问' })
        setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 800)
      }
    })
  },

  loadDetail() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'hrListQuestions',
      data: { examid: this.data.examid, _id: this.data.qid }
    }).then(res => {
      const r = res.result || {}
      const item = (r.list || [])[0]
      if (!r.ok || !item) {
        wx.showToast({ icon: 'none', title: r.msg || '题目不存在' })
        setTimeout(() => wx.navigateBack(), 800)
        return
      }
      const typecode = item.typecode || '01'
      const typeIndex = TYPE_KEYS.indexOf(typecode)
      const options = Array.isArray(item.options) ? item.options.map(o => ({
        code: String(o.code || '').toUpperCase(),
        content: String(o.content || ''),
        value: o.value === '1' ? '1' : '0'
      })) : defaultOptionsForSingleMulti()
      this.setData({
        loading: false,
        title: item.title || '',
        comments: item.comments || '',
        typecode,
        typeIndex: typeIndex >= 0 ? typeIndex : 0,
        isJudge: typecode === '03',
        options
      })
    }).catch(err => {
      console.error(err)
      this.setData({ loading: false })
      wx.showToast({ icon: 'none', title: '网络异常' })
    })
  },

  onTypeChange(e) {
    const idx = Number(e.detail.value) || 0
    const newType = TYPE_KEYS[idx]
    if (newType === this.data.typecode) return
    const oldType = this.data.typecode
    let options = this.data.options.slice()

    if (newType === '03') {
      // 切到判断：强制 2 个选项 A=正确 B=错误
      options = judgeOptions()
    } else if (oldType === '03') {
      // 从判断切出：恢复默认 4 项空白
      options = defaultOptionsForSingleMulti()
    } else if (newType === '01') {
      // 多选 -> 单选：只保留第一个正确项
      let kept = false
      options = options.map(o => {
        if (o.value === '1' && !kept) { kept = true; return o }
        return Object.assign({}, o, { value: '0' })
      })
    }
    // 单选 -> 多选：保持原样

    this.setData({
      typeIndex: idx,
      typecode: newType,
      isJudge: newType === '03',
      options
    })
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value })
  },
  onCommentsInput(e) {
    this.setData({ comments: e.detail.value })
  },

  onOptionContentInput(e) {
    if (this.data.isJudge) return
    const i = Number(e.currentTarget.dataset.i)
    const v = e.detail.value
    const key = 'options[' + i + '].content'
    this.setData({ [key]: v })
  },

  onToggleCorrect(e) {
    const i = Number(e.currentTarget.dataset.i)
    const options = this.data.options.slice()
    const cur = options[i]
    if (!cur) return
    const tc = this.data.typecode
    if (tc === '01' || tc === '03') {
      // 单选/判断：互斥
      for (let k = 0; k < options.length; k++) {
        options[k] = Object.assign({}, options[k], { value: k === i ? '1' : '0' })
      }
    } else {
      // 多选：切换
      options[i] = Object.assign({}, cur, { value: cur.value === '1' ? '0' : '1' })
    }
    this.setData({ options })
  },

  onAddOption() {
    if (this.data.isJudge) return
    const options = this.data.options.slice()
    if (options.length >= MAX_OPTIONS) {
      wx.showToast({ icon: 'none', title: '最多 ' + MAX_OPTIONS + ' 个选项' })
      return
    }
    options.push(makeEmptyOption(CODES[options.length]))
    this.setData({ options })
  },

  onDeleteOption(e) {
    if (this.data.isJudge) return
    const options = this.data.options.slice()
    if (options.length <= MIN_OPTIONS) {
      wx.showToast({ icon: 'none', title: '至少保留 ' + MIN_OPTIONS + ' 个选项' })
      return
    }
    const i = Number(e.currentTarget.dataset.i)
    options.splice(i, 1)
    // 重新编排 code
    const rebuilt = options.map((o, k) => Object.assign({}, o, { code: CODES[k] }))
    this.setData({ options: rebuilt })
  },

  validate() {
    const title = (this.data.title || '').trim()
    if (!title) return '请填写题干'
    const opts = this.data.options || []
    if (opts.length < MIN_OPTIONS) return '至少需要 2 个选项'
    if (this.data.typecode === '03' && opts.length !== 2) return '判断题必须 2 个选项'

    for (let i = 0; i < opts.length; i++) {
      const c = String(opts[i].content || '').trim()
      if (!c) return '选项 ' + opts[i].code + ' 内容必填'
    }
    const correctCount = opts.filter(o => o.value === '1').length
    if (correctCount === 0) return '请至少标记 1 个正确选项'
    if (this.data.typecode === '01' && correctCount !== 1) return '单选题只能有 1 个正确选项'
    if (this.data.typecode === '03' && correctCount !== 1) return '判断题只能有 1 个正确选项'
    if (this.data.typecode === '02' && correctCount < 2) return '多选题至少要有 2 个正确选项'
    return ''
  },

  onSave() {
    if (this.data.saving) return
    const err = this.validate()
    if (err) {
      wx.showToast({ icon: 'none', title: err })
      return
    }
    const payload = {
      examid: this.data.examid,
      typecode: this.data.typecode,
      title: (this.data.title || '').trim(),
      comments: (this.data.comments || '').trim(),
      options: this.data.options.map(o => ({
        code: String(o.code || '').toUpperCase(),
        content: String(o.content || '').trim(),
        value: o.value === '1' ? '1' : '0'
      }))
    }
    if (!this.data.isCreate) payload._id = this.data.qid

    this.setData({ saving: true })
    wx.showLoading({ title: '保存中…', mask: true })
    wx.cloud.callFunction({ name: 'hrSaveQuestion', data: payload })
      .then(res => {
        wx.hideLoading()
        this.setData({ saving: false })
        const r = res.result || {}
        if (r.ok) {
          wx.showToast({ icon: 'success', title: '已保存' })
          setTimeout(() => wx.navigateBack(), 500)
          return
        }
        wx.showModal({
          title: '保存失败',
          content: r.message || r.msg || '请检查输入',
          showCancel: false
        })
      })
      .catch(err => {
        wx.hideLoading()
        this.setData({ saving: false })
        console.error(err)
        wx.showToast({ icon: 'none', title: '网络异常' })
      })
  },

  onCancel() {
    wx.navigateBack()
  }
})
