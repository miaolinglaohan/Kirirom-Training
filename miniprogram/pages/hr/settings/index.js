// pages/hr/settings/index.js
//
// HR 系统设置页（仅 admin 可见可改）。
// 当前两项：
//   1) pdfWatermark：PDF 半透明斜向水印文字（≤60）
//   2) unitName    ：单位名称，会印在 PDF 总分单右下角（≤40）
//
// 两项各自独立保存（互不影响）。

const app = getApp()

const DEFAULT_WATERMARK = '基里隆项目部内部资料 · 严禁外传'
const DEFAULT_UNIT = '基里隆Ⅰ&Ⅲ水电站运维项目部'
const MAX_WM = 60
const MAX_UN = 40

Page({
  data: {
    loading: true,
    me: null,

    // 水印
    watermark: '',
    watermarkInitial: '',
    wmCounter: '0 / 60',
    wmSaving: false,

    // 单位名
    unitName: '',
    unitNameInitial: '',
    unCounter: '0 / 40',
    unSaving: false
  },

  onShow() {
    app.guardAuth().then(emp => {
      if (!emp) return
      if (emp.role !== 'admin') {
        wx.showToast({ icon: 'none', title: '仅 admin 可访问系统设置' })
        setTimeout(() => wx.navigateBack(), 800)
        return
      }
      this.setData({ me: emp })
      this.loadConfig()
    })
  },

  // 并行拉取两项配置，任一失败都仅 fallback default，不阻断另一项
  loadConfig() {
    this.setData({ loading: true })
    Promise.all([
      this._callGet('pdfWatermark'),
      this._callGet('unitName')
    ]).then(([wm, un]) => {
      // 显示值：DB 有就用 DB 的，DB 空就兜底默认（让用户看到合理初值）
      // 初始值（用于判断"没有变化"）：只认 DB 真实值（可能为空字符串）
      //   这样从未保存过的字段，用户点保存能把兜底默认写入 DB，而不是被"没变化"卡住
      const wmVal = wm.length > 0 ? wm : DEFAULT_WATERMARK
      const unVal = un.length > 0 ? un : DEFAULT_UNIT
      this.setData({
        loading: false,
        watermark: wmVal,
        watermarkInitial: wm,
        wmCounter: wmVal.length + ' / ' + MAX_WM,
        unitName: unVal,
        unitNameInitial: un,
        unCounter: unVal.length + ' / ' + MAX_UN
      })
    }).catch(err => {
      console.error('[hr.settings] load error', err)
      wx.showToast({ icon: 'none', title: '网络异常' })
      this.setData({ loading: false })
    })
  },

  _callGet(key) {
    return wx.cloud.callFunction({
      name: 'hrSysConfig',
      data: { action: 'get', key }
    }).then(res => {
      const r = res.result || {}
      return r.ok ? (r.value || '') : ''
    })
  },

  // ---------- 水印 ----------
  onInputWatermark(e) {
    let v = String(e.detail.value || '')
    if (v.length > MAX_WM) v = v.slice(0, MAX_WM)
    this.setData({ watermark: v, wmCounter: v.length + ' / ' + MAX_WM })
  },

  onResetWatermark() {
    wx.showModal({
      title: '恢复默认',
      content: '水印重置为：\n' + DEFAULT_WATERMARK,
      success: r => {
        if (r.confirm) {
          this.setData({
            watermark: DEFAULT_WATERMARK,
            wmCounter: DEFAULT_WATERMARK.length + ' / ' + MAX_WM
          })
        }
      }
    })
  },

  onSaveWatermark() {
    const v = String(this.data.watermark || '').trim()
    if (!v) { wx.showToast({ icon: 'none', title: '水印不能为空' }); return }
    if (v === this.data.watermarkInitial) { wx.showToast({ icon: 'none', title: '没有变化' }); return }
    if (this.data.wmSaving) return
    this.setData({ wmSaving: true })
    this._callSet('pdfWatermark', v).then(() => {
      this.setData({ watermarkInitial: v, wmSaving: false })
      wx.showToast({ icon: 'success', title: '已保存' })
    }).catch(msg => {
      this.setData({ wmSaving: false })
      this._showSaveError(msg)
    })
  },

  // ---------- 单位名 ----------
  onInputUnit(e) {
    let v = String(e.detail.value || '')
    if (v.length > MAX_UN) v = v.slice(0, MAX_UN)
    this.setData({ unitName: v, unCounter: v.length + ' / ' + MAX_UN })
  },

  onResetUnit() {
    wx.showModal({
      title: '恢复默认',
      content: '单位名重置为：\n' + DEFAULT_UNIT,
      success: r => {
        if (r.confirm) {
          this.setData({
            unitName: DEFAULT_UNIT,
            unCounter: DEFAULT_UNIT.length + ' / ' + MAX_UN
          })
        }
      }
    })
  },

  onSaveUnit() {
    const v = String(this.data.unitName || '').trim()
    if (!v) { wx.showToast({ icon: 'none', title: '单位名不能为空' }); return }
    if (v === this.data.unitNameInitial) { wx.showToast({ icon: 'none', title: '没有变化' }); return }
    if (this.data.unSaving) return
    this.setData({ unSaving: true })
    this._callSet('unitName', v).then(() => {
      this.setData({ unitNameInitial: v, unSaving: false })
      wx.showToast({ icon: 'success', title: '已保存' })
    }).catch(msg => {
      this.setData({ unSaving: false })
      this._showSaveError(msg)
    })
  },

  // ---------- 通用工具 ----------
  _callSet(key, value) {
    return wx.cloud.callFunction({
      name: 'hrSysConfig',
      data: { action: 'set', key, value }
    }).then(res => {
      const r = res.result || {}
      if (!r.ok) throw r.message || '保存失败'
      return r
    })
  },

  _showSaveError(msg) {
    const m = String(msg || '保存失败')
    if (m.length > 14) {
      wx.showModal({ title: '保存失败', content: m, showCancel: false })
    } else {
      wx.showToast({ icon: 'none', title: m })
    }
  }
})
