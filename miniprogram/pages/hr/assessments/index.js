const app = getApp()

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  const pad = n => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

Page({
  data: {
    loading: true,
    list: []
  },

  onShow() {
    app.guardAuth().then(emp => {
      if (!emp) return
      if (emp.role !== 'hr' && emp.role !== 'admin') {
        wx.showToast({ icon: 'none', title: '无权访问' })
        setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 800)
        return
      }
      this.loadList()
    })
  },

  loadList() {
    this.setData({ loading: true })
    wx.cloud.callFunction({ name: 'hrListAssessments' })
      .then(res => {
        const r = res.result || {}
        if (!r.ok) {
          wx.showToast({ icon: 'none', title: r.msg || '加载失败' })
          this.setData({ loading: false })
          return
        }
        const list = (r.list || []).map(a => Object.assign({}, a, {
          startTimeText: fmtTime(a.startTime),
          totalQuestions: a.totalQuestions || a.questionCount || 0,
          fullScore: a.fullScore || 0,
          enrolled: a.enrolled || 0,
          submitted: a.submitted || 0
        }))
        this.setData({ loading: false, list })
      })
      .catch(err => {
        console.error(err)
        wx.showToast({ icon: 'none', title: '网络异常' })
        this.setData({ loading: false })
      })
  },

  onCreate() {
    wx.navigateTo({ url: '/pages/hr/assessmentEdit/index' })
  },

  onEdit(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.list.find(x => x._id === id)
    // 已结束/已提前结束的考试不允许编辑（防止改时间"复活"）
    if (item && item.endedAt) {
      wx.showToast({ icon: 'none', title: '该考试已提前结束，不可编辑' })
      return
    }
    if (item && item.status === 'expired') {
      wx.showToast({ icon: 'none', title: '该考试已结束，不可编辑' })
      return
    }
    wx.navigateTo({ url: '/pages/hr/assessmentEdit/index?id=' + id })
  },

  // catchtap：避免冒泡触发 .item 的 onEdit
  onScores(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/hr/assessmentScores/index?id=' + id })
  },

  // 提前结束考试：把 validUntil 截断到当前时刻，进行中/候考的考试立即变已截止
  onEnd(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.list.find(x => x._id === id)
    if (!item) return
    // 已截止/隐藏的不应该能点（按钮已 disabled），这里兜底
    if (item.status === 'expired' || item.status === 'hidden') {
      wx.showToast({ icon: 'none', title: '该考试已结束' })
      return
    }
    wx.showModal({
      title: '提前结束考试',
      content: `确定要立即结束「${item.name}」吗？\n结束后员工将无法再进场，已交卷的成绩不受影响。`,
      confirmText: '结束',
      confirmColor: '#c0392b',
      success: r => {
        if (!r.confirm) return
        wx.showLoading({ title: '处理中…', mask: true })
        wx.cloud.callFunction({ name: 'hrEndAssessment', data: { _id: id } })
          .then(res => {
            wx.hideLoading()
            const ret = res.result || {}
            if (ret.ok) {
              wx.showToast({ icon: 'success', title: '已结束' })
              // 即时更新本地状态：标记 endedAt + status 变 expired，按钮立即变灰
              const list = this.data.list.map(x => {
                if (x._id !== id) return x
                return { ...x, endedAt: new Date().toISOString(), status: 'expired' }
              })
              this.setData({ list })
              // 再异步拉取一次保证与服务端一致
              this.loadList()
            } else if (ret.code === 'ALREADY_ENDED') {
              wx.showToast({ icon: 'none', title: '该考试已结束过' })
              this.loadList()
            } else {
              wx.showToast({ icon: 'none', title: ret.message || '操作失败' })
            }
          })
          .catch(err => {
            console.error('[onEnd]', err)
            wx.hideLoading()
            wx.showToast({ icon: 'none', title: '网络异常' })
          })
      }
    })
  },

  onPullDownRefresh() {
    this.loadList()
    wx.stopPullDownRefresh()
  }
})
