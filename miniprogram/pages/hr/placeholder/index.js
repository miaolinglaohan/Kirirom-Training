Page({
  data: { title: '', tip: '' },
  onLoad(opts) {
    const kind = (opts && opts.kind) || ''
    let title = '功能开发中'
    let tip = ''
    if (kind === 'subjects') {
      title = '题库管理'
      tip = '题库的增删改将在 v0.3.2 上线。\n\n当前请在云开发控制台手动维护 exam 集合。'
    } else if (kind === 'questions') {
      title = '题目管理'
      tip = '题目的批量增删改将在 v0.3.2 上线。\n\n当前请在云开发控制台手动维护 questions 集合，或通过 data/questions.json 导入。'
    }
    wx.setNavigationBarTitle({ title })
    this.setData({ title, tip })
  },
  onBack() { wx.navigateBack() }
})
