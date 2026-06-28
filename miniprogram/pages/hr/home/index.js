// pages/hr/home/index.js
//
// HR 管理后台首页：4 入口卡片。
// 任何非 HR 进入此页都自动 reLaunch 回普通首页（双保险，前端 + 云函数都拦）。

const app = getApp()

Page({
  data: {
    me: null
  },

  onShow() {
    app.guardAuth().then(emp => {
      if (!emp) return
      if (emp.role !== 'hr') {
        wx.showToast({ icon: 'none', title: '无权访问管理后台' })
        setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 800)
        return
      }
      this.setData({ me: emp })
    })
  },

  goEmployees() { wx.navigateTo({ url: '/pages/hr/employees/index' }) },
  goAssessments() { wx.navigateTo({ url: '/pages/hr/assessments/index' }) },
  goSubjects() { wx.navigateTo({ url: '/pages/hr/placeholder/index?kind=subjects' }) },
  goQuestions() { wx.navigateTo({ url: '/pages/hr/placeholder/index?kind=questions' }) }
})
