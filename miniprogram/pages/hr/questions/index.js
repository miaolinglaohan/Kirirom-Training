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
    examid: '',
    subjectName: '',
    tabs: TYPE_TABS,
    activeTab: '',
    list: [],
    skip: 0,
    limit: 20,
    total: 0,
    loading: true,
    loadingMore: false,
    hasMore: false
  },

  onLoad(opts) {
    const examid = opts && opts.examid ? decodeURIComponent(opts.examid) : ''
    const name = opts && opts.name ? decodeURIComponent(opts.name) : ''
    this.setData({ examid, subjectName: name })
    if (name) {
      wx.setNavigationBarTitle({ title: name })
    }
  },

  onShow() {
    if (!this.data.examid) {
      wx.showToast({ icon: 'none', title: '参数缺失' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    app.guardAuth().then(emp => {
      if (!emp) return
      if (emp.role !== 'hr' && emp.role !== 'admin') {
        wx.showToast({ icon: 'none', title: '无权访问' })
        setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 800)
        return
      }
      this.loadList(true)
    })
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
    wx.navigateTo({
      url: '/pages/hr/questionEdit/index?examid=' + encodeURIComponent(this.data.examid)
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
