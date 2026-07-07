const app = getApp()

const TYPE_TABS = [
  { key: '',   label: '全部' },
  { key: '01', label: '单选' },
  { key: '02', label: '多选' },
  { key: '03', label: '判断' }
]
const TYPE_NAME = { '01': '单选', '02': '多选', '03': '判断' }
const TYPE_CLASS = { '01': 'single', '02': 'multi', '03': 'judge' }

Page({
  data: {
    examid: '',             // 空 = 全局模式（题目管理入口）；非空 = 单题库模式（从题库进入）
    subjectName: '',
    subjects: [],           // 全局模式下的题库列表（供筛选 picker 用）
    subjectIndex: -1,       // picker 选中索引，-1 = 全部题库
    tabs: TYPE_TABS,
    activeTab: '',
    list: [],
    skip: 0,
    limit: 20,
    total: 0,
    loading: true,
    loadingMore: false,
    hasMore: false,
    importing: false
  },

  onLoad(opts) {
    const examid = opts && opts.examid ? decodeURIComponent(opts.examid) : ''
    const name = opts && opts.name ? decodeURIComponent(opts.name) : ''
    this.setData({ examid, subjectName: name })
    if (name) {
      wx.setNavigationBarTitle({ title: name })
    } else if (!examid) {
      wx.setNavigationBarTitle({ title: '题目管理' })
    }
  },

  onShow() {
    app.guardAuth().then(emp => {
      if (!emp) return
      if (emp.role !== 'hr' && emp.role !== 'admin') {
        wx.showToast({ icon: 'none', title: '无权访问' })
        setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 800)
        return
      }
      // 全局模式下加载题库列表供筛选
      if (!this.data.examid) {
        this.loadSubjects()
      }
      this.loadList(true)
    })
  },

  // 全局模式下加载题库列表（供筛选 picker）
  loadSubjects() {
    wx.cloud.callFunction({ name: 'hrListSubjects' })
      .then(res => {
        const r = res.result || {}
        if (!r.ok) return
        const subjects = (r.list || []).map(s => ({
          _id: s._id,
          name: s.name || s._id
        }))
        this.setData({ subjects })
      })
      .catch(() => {})
  },

  // 题库筛选 picker 切换
  onSubjectChange(e) {
    const idx = Number(e.detail.value)
    if (idx === this.data.subjectIndex) return
    const sub = idx >= 0 ? this.data.subjects[idx] : null
    this.setData({
      subjectIndex: idx,
      examid: sub ? sub._id : '',
      subjectName: sub ? sub.name : ''
    })
    this.loadList(true)
  },

  // 清除题库筛选（回到全部）
  onClearSubject() {
    if (this.data.subjectIndex < 0) return
    this.setData({
      subjectIndex: -1,
      examid: '',
      subjectName: ''
    })
    this.loadList(true)
  },

  onTabChange(e) {
    const key = e.currentTarget.dataset.key || ''
    if (key === this.data.activeTab) return
    this.setData({ activeTab: key })
    this.loadList(true)
  },

  loadList(reset) {
    if (reset) {
      this.setData({ loading: true, skip: 0, list: [], hasMore: false })
    } else {
      if (this.data.loadingMore || !this.data.hasMore) return
      this.setData({ loadingMore: true })
    }
    const data = {
      examid: this.data.examid,
      skip: this.data.skip,
      limit: this.data.limit
    }
    if (this.data.activeTab) data.typecode = this.data.activeTab

    wx.cloud.callFunction({ name: 'hrListQuestions', data })
      .then(res => {
        const r = res.result || {}
        if (!r.ok) {
          wx.showToast({ icon: 'none', title: r.msg || '加载失败' })
          this.setData({ loading: false, loadingMore: false })
          return
        }
        const incoming = (r.list || []).map(q => this.decorate(q))
        const merged = reset ? incoming : this.data.list.concat(incoming)
        const total = Number(r.total) || 0
        this.setData({
          list: merged,
          total,
          skip: merged.length,
          hasMore: merged.length < total,
          loading: false,
          loadingMore: false
        })
      })
      .catch(err => {
        console.error(err)
        wx.showToast({ icon: 'none', title: '网络异常' })
        this.setData({ loading: false, loadingMore: false })
      })
  },

  decorate(q) {
    const options = Array.isArray(q.options) ? q.options : []
    const correct = options.filter(o => o && o.value === '1').map(o => o.code).join(',')
    return Object.assign({}, q, {
      typeName: TYPE_NAME[q.typecode] || q.typecode || '?',
      typeClass: TYPE_CLASS[q.typecode] || '',
      optionCount: options.length,
      correctText: correct || '（未设置）'
    })
  },

  onCreate() {
    if (!this.data.examid) {
      wx.showToast({ icon: 'none', title: '请先选择题库再新建题目' })
      return
    }
    wx.navigateTo({
      url: '/pages/hr/questionEdit/index?examid=' + encodeURIComponent(this.data.examid)
    })
  },

  // 批量导入题目到当前筛选的题库
  onImport() {
    if (this.data.importing) return
    if (!this.data.examid) {
      wx.showToast({ icon: 'none', title: '请先选择题库再导入' })
      return
    }
    const subjectName = this.data.subjectName || this.data.examid
    wx.showModal({
      title: '导入题目',
      content: `将导入到题库「${subjectName}」\nCSV 中的题库ID 列会被忽略\n确定继续？`,
      success: r => {
        if (!r.confirm) return
        this.chooseAndImport()
      }
    })
  },

  chooseAndImport() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv'],
      success: res => {
        const file = res.tempFiles[0]
        if (!file) return
        if (file.size > 10 * 1024 * 1024) {
          wx.showToast({ icon: 'none', title: '文件过大（>10MB）' })
          return
        }
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: r => {
            this.doImport(r.data)
          },
          fail: () => {
            wx.showToast({ icon: 'none', title: '文件读取失败' })
          }
        })
      }
    })
  },

  doImport(csv) {
    this.setData({ importing: true })
    wx.showLoading({ title: '导入中…', mask: true })
    wx.cloud.callFunction({
      name: 'hrImportQuestions',
      data: { csv, subjectId: this.data.examid }
    }).then(res => {
      wx.hideLoading()
      this.setData({ importing: false })
      const r = res.result || {}
      if (!r.ok) {
        wx.showModal({ title: '导入失败', content: r.message || '未知错误', showCancel: false })
        return
      }
      let content = `成功：${r.inserted} 条`
      if (r.errors && r.errors.length > 0) {
        const errLines = r.errors.slice(0, 10).map(e => `第 ${e.row} 行：${e.msg}`).join('\n')
        content += `\n失败：${r.errors.length} 条\n${errLines}`
        if (r.errors.length > 10) content += `\n... 等 ${r.errors.length - 10} 条`
      }
      wx.showModal({
        title: '导入完成',
        content,
        showCancel: false,
        success: () => this.loadList(true)
      })
    }).catch(err => {
      console.error('[import]', err)
      wx.hideLoading()
      this.setData({ importing: false })
      wx.showToast({ icon: 'none', title: '网络异常' })
    })
  },

  onEdit(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: '/pages/hr/questionEdit/index?examid=' + encodeURIComponent(this.data.examid) + '&id=' + encodeURIComponent(id)
    })
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id
    const title = e.currentTarget.dataset.title || id
    const short = title.length > 30 ? title.slice(0, 30) + '…' : title
    wx.showModal({
      title: '删除题目',
      content: `确定删除题目「${short}」？此操作不可恢复。`,
      confirmText: '删除',
      confirmColor: '#f56c6c',
      success: r => {
        if (r.confirm) this.doDelete(id)
      }
    })
  },

  doDelete(id) {
    wx.showLoading({ title: '删除中…', mask: true })
    wx.cloud.callFunction({ name: 'hrDeleteQuestion', data: { _id: id } })
      .then(res => {
        wx.hideLoading()
        const r = res.result || {}
        if (r.ok) {
          wx.showToast({ icon: 'success', title: '已删除' })
          this.loadList(true)
          return
        }
        wx.showToast({ icon: 'none', title: r.message || r.msg || '删除失败' })
      })
      .catch(err => {
        wx.hideLoading()
        console.error(err)
        wx.showToast({ icon: 'none', title: '网络异常' })
      })
  },

  onReachBottom() {
    if (this.data.hasMore) this.loadList(false)
  },

  onPullDownRefresh() {
    this.loadList(true)
    wx.stopPullDownRefresh()
  }
})
