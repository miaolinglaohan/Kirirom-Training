// pages/hr/employeeEdit/index.js
//
// 员工编辑页：新建 / 修改 角色 / 部门 / 启用停用 / openid。
// admin 行只读（全部字段不可改），提示去云开发控制台。
//
// 入参：
//   ?id=xxx    → 编辑已有员工
//   ?create=1  → 新建员工（姓名/部门/角色/openid 手动填）

const app = getApp()

const DEPTS = ['项目部', '运行检修部', '综合管理部', '枢纽管理部', '安全技术部', '财务资金部']

Page({
  data: {
    loading: true,
    isCreate: false,    // 新建模式
    emp: null,          // 原始员工对象（编辑模式才有）
    name: '',
    dept: '',
    deptIndex: -1,
    role: 'employee',
    active: true,
    openid: '',         // 新建模式：手动输入；编辑模式：只读显示
    isAdmin: false,
    isSelf: false,
    saving: false
  },

  onLoad(opts) {
    const isCreate = !!(opts && opts.create)
    this.setData({ isCreate })
    if (!isCreate) {
      this.id = (opts && opts.id) ? String(opts.id) : ''
      if (!this.id) {
        wx.showToast({ icon: 'none', title: '缺少参数' })
        setTimeout(() => wx.navigateBack(), 800)
      }
    }
    wx.setNavigationBarTitle({ title: isCreate ? '新建员工' : '编辑员工' })
  },

  onShow() {
    app.guardAuth().then(emp => {
      if (!emp) return
      if (emp.role !== 'hr' && emp.role !== 'admin') {
        wx.showToast({ icon: 'none', title: '无权访问' })
        setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 800)
        return
      }
      if (this.data.isCreate) {
        this.setData({ loading: false })
      } else {
        this.loadEmployee()
      }
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
          openid: emp.openid || '',
          isAdmin: emp.role === 'admin',
          isSelf: app.globalData.openid && emp.openid === app.globalData.openid
        })
        wx.setNavigationBarTitle({ title: `编辑 · ${emp.name || ''}` })
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

  onInputName(e) {
    this.setData({ name: e.detail.value })
  },
  onInputOpenid(e) {
    this.setData({ openid: e.detail.value.trim() })
  },

  onSave() {
    if (this.data.saving) return
    if (this.data.isAdmin) {
      wx.showToast({ icon: 'none', title: '超管账号请在控制台修改' })
      return
    }

    // 校验
    if (!this.data.name.trim()) {
      wx.showToast({ icon: 'none', title: '请填写姓名' })
      return
    }
    if (this.data.deptIndex < 0) {
      wx.showToast({ icon: 'none', title: '请选择部门' })
      return
    }

    if (this.data.isCreate) {
      // 新建模式：调 hrSetEmployee 创建
      if (!this.data.openid.trim()) {
        wx.showToast({ icon: 'none', title: '请填写用户码（openid）' })
        return
      }
      this._doCreate()
    } else {
      // 编辑模式：自锁保护
      if (this.data.isSelf && this.data.role === 'employee') {
        wx.showToast({ icon: 'none', title: '不能取消自己的管理权限' })
        return
      }
      if (this.data.isSelf && !this.data.active) {
        wx.showToast({ icon: 'none', title: '不能停用自己' })
        return
      }
      this._doUpdate()
    }
  },

  _doCreate() {
    this.setData({ saving: true })
    const data = {
      _id: '',   // 空 _id 表示新建
      name: this.data.name.trim(),
      dept: this.data.dept,
      role: this.data.role,
      active: this.data.active,
      openid: this.data.openid
    }
    wx.cloud.callFunction({ name: 'hrSetEmployee', data }).then(res => {
      this.setData({ saving: false })
      const r = res.result || {}
      if (r.ok) {
        wx.showToast({ icon: 'success', title: '已创建' })
        setTimeout(() => wx.navigateBack(), 600)
      } else {
        this.showErr(r)
      }
    }).catch(err => {
      console.error('[employeeEdit] create', err)
      this.setData({ saving: false })
      wx.showToast({ icon: 'none', title: '网络异常' })
    })
  },

  _doUpdate() {
    const patch = {
      role: this.data.role,
      active: this.data.active,
      dept: this.data.dept
    }
    // openid 有变动时也提交
    const newOpenid = this.data.openid || ''
    const oldOpenid = (this.data.emp && this.data.emp.openid) || ''
    if (newOpenid !== oldOpenid) {
      patch.openid = newOpenid
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
      PROTECTED: '超管账号请在控制台修改',
      DUPLICATE_OPENID: '该用户码已被其他员工绑定'
    }
    wx.showToast({ icon: 'none', title: msgMap[r.code] || r.message || '保存失败' })
  }
})
