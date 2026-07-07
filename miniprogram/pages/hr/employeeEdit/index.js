// pages/hr/employeeEdit/index.js
//
// 员工编辑页：修改角色 / 部门 / 启用停用。
// admin 行只读（全部字段不可改），提示去云开发控制台。

const app = getApp()

const DEPTS = ['项目部', '运行检修部', '综合管理部', '枢纽管理部', '安全技术部', '财务资金部']

Page({
  data: {
    loading: true,
    emp: null,          // 原始员工对象
    name: '',
    dept: '',
    deptIndex: -1,
    role: 'employee',   // employee / hr / admin
    active: true,
    isAdmin: false,     // 是否为 admin 超管（只读）
    isSelf: false,      // 是否为当前登录账号（不能取消自己权限）
    saving: false
  },

  onLoad(opts) {
    this.id = (opts && opts.id) ? String(opts.id) : ''
    if (!this.id) {
      wx.showToast({ icon: 'none', title: '缺少参数' })
      setTimeout(() => wx.navigateBack(), 800)
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
      this.loadEmployee()
    })
  },

  loadEmployee() {
    wx.cloud.callFunction({ name: 'hrListEmployees' })
      .then(res => {
        const r = res.result || {}
        if (!r.ok) {
          wx.showToast({ icon: 'none', title: r.msg || '加载失败' })
          this.setData({ loading: false })
          return
        }
        const emp = (r.list || []).find(x => x._id === this.id)
        if (!emp) {
          wx.showToast({ icon: 'none', title: '员工不存在' })
          setTimeout(() => wx.navigateBack(), 800)
          return
        }
        const deptIndex = DEPTS.indexOf(emp.dept || '')
        this.setData({
          loading: false,
          emp,
          name: emp.name || '',
          dept: emp.dept || '',
          deptIndex: deptIndex >= 0 ? deptIndex : -1,
          role: emp.role || 'employee',
          active: emp.active !== false,
          isAdmin: emp.role === 'admin',
          isSelf: app.globalData.openid && emp.openid === app.globalData.openid
        })
        wx.setNavigationBarTitle({ title: `编辑 · ${emp.name || ''}` })
      })
      .catch(err => {
        console.error('[employeeEdit] load', err)
        wx.showToast({ icon: 'none', title: '网络异常' })
        this.setData({ loading: false })
      })
  },

  onDeptChange(e) {
    const idx = Number(e.detail.value)
    this.setData({ deptIndex: idx, dept: DEPTS[idx] })
  },

  onRoleChange(e) {
    if (this.data.isAdmin) return
    this.setData({ role: e.detail.value })
  },

  onActiveChange(e) {
    if (this.data.isAdmin) return
    this.setData({ active: e.detail.value })
  },

  onSave() {
    if (this.data.saving) return
    if (this.data.isAdmin) {
      wx.showToast({ icon: 'none', title: '超管账号请在控制台修改' })
      return
    }

    // 自锁保护
    if (this.data.isSelf && this.data.role === 'employee') {
      wx.showToast({ icon: 'none', title: '不能取消自己的管理权限' })
      return
    }
    if (this.data.isSelf && !this.data.active) {
      wx.showToast({ icon: 'none', title: '不能停用自己' })
      return
    }

    const patch = {
      role: this.data.role,
      active: this.data.active,
      dept: this.data.dept
    }

    this.setData({ saving: true })
    wx.cloud.callFunction({
      name: 'hrSetEmployee',
      data: { _id: this.id, patch }
    }).then(res => {
      this.setData({ saving: false })
      const r = res.result || {}
      if (r.ok) {
        wx.showToast({ icon: 'success', title: '已保存' })
        setTimeout(() => wx.navigateBack(), 600)
      } else {
        this.showErr(r)
      }
    }).catch(err => {
      console.error('[employeeEdit] save', err)
      this.setData({ saving: false })
      wx.showToast({ icon: 'none', title: '网络异常' })
    })
  },

  showErr(r) {
    const msgMap = {
      FORBIDDEN: '无 HR 权限',
      SELF_LOCK: '不能修改自己的权限或停用自己',
      NOT_FOUND: '员工不存在',
      INVALID_ROLE: '角色值无效',
      PROTECTED: '超管账号请在控制台修改'
    }
    wx.showToast({ icon: 'none', title: msgMap[r.code] || r.message || '保存失败' })
  }
})
