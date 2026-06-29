// pages/hr/settings/index.js
//
// HR 系统设置页（仅 admin 可见可改）。
// 当前版本只有 1 项：PDF 水印文字。后续若有其它系统级配置可直接扩。

const app = getApp()

const DEFAULT_WATERMARK = '基里隆项目部内部资料 · 严禁外传'
const MAX_LEN = 60

Page({
  data: {
    loading: true,
    me: null,
    canEdit: false,           // 仅 admin
    watermark: '',            // textarea 双向绑定值
    watermarkInitial: '',     // 用于判断是否修改过
    counter: '0 / 60',
    saving: false
  },

  onShow() {
    app.guardAuth().then(emp => {
      if (!emp) return
      if (emp.role !== 'admin') {
        wx.showToast({ icon: 'none', title: '仅 admin 可访问系统设置' })
        setTimeout(() => wx.navigateBack(), 800)
        return
      }
      this.setData({ me: emp, canEdit: true })
      this.loadConfig()
    })
  },

  loadConfig() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'hrSysConfig',
      data: { action: 'get', key: 'pdfWatermark' }
    }).then(res => {
      const r = res.result || {}
      if (!r.ok) {
        wx.showToast({ icon: 'none', title: r.message || '加载失败' })
        this.setData({ loading: false })
        return
      }
      const v = (r.value && r.value.length > 0) ? r.value : DEFAULT_WATERMARK
      this.setData({
        loading: false,
        watermark: v,
        watermarkInitial: v,
        counter: v.length + ' / ' + MAX_LEN
      })
    }).catch(err => {
      console.error('[hr.settings] load error', err)
      wx.showToast({ icon: 'none', title: '网络异常' })
      this.setData({ loading: false })
    })
  },

  onInputWatermark(e) {
    let v = String(e.detail.value || '')
    if (v.length > MAX_LEN) v = v.slice(0, MAX_LEN)
    this.setData({
      watermark: v,
      counter: v.length + ' / ' + MAX_LEN
    })
  },

  onResetDefault() {
    wx.showModal({
      title: '恢复默认',
      content: '将水印重置为：\n' + DEFAULT_WATERMARK,
      success: r => {
        if (r.confirm) {
          this.setData({
            watermark: DEFAULT_WATERMARK,
            counter: DEFAULT_WATERMARK.length + ' / ' + MAX_LEN
          })
        }
      }
    })
  },

  onSave() {
    const v = String(this.data.watermark || '').trim()
    if (!v) {
      wx.showToast({ icon: 'none', title: '水印不能为空' })
      return
    }
    if (v === this.data.watermarkInitial) {
      wx.showToast({ icon: 'none', title: '没有变化' })
      return
    }
    if (this.data.saving) return
    this.setData({ saving: true })
    wx.cloud.callFunction({
      name: 'hrSysConfig',
      data: { action: 'set', key: 'pdfWatermark', value: v }
    }).then(res => {
      const r = res.result || {}
      this.setData({ saving: false })
      if (!r.ok) {
        // 长错误提示（如集合不存在）用 modal，不会被截断
        const msg = r.message || '保存失败'
        if (msg.length > 14) {
          wx.showModal({ title: '保存失败', content: msg, showCancel: false })
        } else {
          wx.showToast({ icon: 'none', title: msg })
        }
        return
      }
      this.setData({ watermarkInitial: v })
      wx.showToast({ icon: 'success', title: '已保存' })
    }).catch(err => {
      console.error('[hr.settings] save error', err)
      this.setData({ saving: false })
      wx.showToast({ icon: 'none', title: '网络异常' })
    })
  }
})
