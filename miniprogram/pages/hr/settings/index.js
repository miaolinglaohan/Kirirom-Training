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

// 水印样式默认值（与 pdfCanvas.js drawWatermark 写死值保持一致）
const DEFAULT_WM_STYLE = {
  fontPx: 30,    // 字号 10~80
  alpha: 0.05,   // 透明度 0.01~0.5
  gapX: 160,     // 横向间隙 0~500
  lineMul: 5,    // 行距倍数 2~15
  angle: -45     // 旋转角度(度) -90~90
}
// 各参数允许范围（保存时 clamp）
const WM_STYLE_RANGE = {
  fontPx:  { min: 10, max: 80 },
  alpha:   { min: 0.01, max: 0.5, step: 0.01 },
  gapX:    { min: 0, max: 500 },
  lineMul: { min: 2, max: 15 },
  angle:   { min: -90, max: 90 }
}

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
    unSaving: false,

    // 水印样式
    wmFontPx: DEFAULT_WM_STYLE.fontPx,
    wmAlpha: DEFAULT_WM_STYLE.alpha,
    wmGapX: DEFAULT_WM_STYLE.gapX,
    wmLineMul: DEFAULT_WM_STYLE.lineMul,
    wmAngle: DEFAULT_WM_STYLE.angle,
    wmStyleInitial: '',   // DB 原始 JSON 串，用于判断"没变化"
    wmStyleSaving: false
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

  // 并行拉取配置，任一失败都仅 fallback default，不阻断另一项
  loadConfig() {
    this.setData({ loading: true })
    Promise.all([
      this._callGet('pdfWatermark'),
      this._callGet('unitName'),
      this._callGet('pdfWatermarkStyle')
    ]).then(([wm, un, wmStyleRaw]) => {
      // 显示值：DB 有就用 DB 的，DB 空就兜底默认（让用户看到合理初值）
      // 初始值（用于判断"没有变化"）：只认 DB 真实值（可能为空字符串）
      //   这样从未保存过的字段，用户点保存能把兜底默认写入 DB，而不是被"没变化"卡住
      const wmVal = wm.length > 0 ? wm : DEFAULT_WATERMARK
      const unVal = un.length > 0 ? un : DEFAULT_UNIT
      // 水印样式：DB 有则解析，无/解析失败则用默认值
      let styleObj = Object.assign({}, DEFAULT_WM_STYLE)
      if (wmStyleRaw) {
        try {
          const parsed = JSON.parse(wmStyleRaw)
          if (parsed && typeof parsed === 'object') {
            styleObj = Object.assign({}, DEFAULT_WM_STYLE, parsed)
          }
        } catch (e) { /* 用默认 */ }
      }
      this.setData({
        loading: false,
        watermark: wmVal,
        watermarkInitial: wm,
        wmCounter: wmVal.length + ' / ' + MAX_WM,
        unitName: unVal,
        unitNameInitial: un,
        unCounter: unVal.length + ' / ' + MAX_UN,
        wmFontPx: styleObj.fontPx,
        wmAlpha: styleObj.alpha,
        wmGapX: styleObj.gapX,
        wmLineMul: styleObj.lineMul,
        wmAngle: styleObj.angle,
        wmStyleInitial: wmStyleRaw || ''
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

  // ---------- 水印样式 ----------
  // 5 个参数滑块/输入：改值即更新 data（不立即保存）
  onInputWmFontPx(e) {
    this.setData({ wmFontPx: this._clampNum(Number(e.detail.value), 'fontPx') })
  },
  onInputWmAlpha(e) {
    this.setData({ wmAlpha: this._clampNum(Number(e.detail.value), 'alpha') })
  },
  onInputWmGapX(e) {
    this.setData({ wmGapX: this._clampNum(Number(e.detail.value), 'gapX') })
  },
  onInputWmLineMul(e) {
    this.setData({ wmLineMul: this._clampNum(Number(e.detail.value), 'lineMul') })
  },
  onInputWmAngle(e) {
    this.setData({ wmAngle: this._clampNum(Number(e.detail.value), 'angle') })
  },

  // 数值 clamp 到允许范围
  _clampNum(v, key) {
    const r = WM_STYLE_RANGE[key]
    if (isNaN(v)) v = DEFAULT_WM_STYLE[key]
    v = Math.max(r.min, Math.min(r.max, v))
    return v
  },

  onResetWmStyle() {
    wx.showModal({
      title: '恢复默认',
      content: '水印样式参数重置为默认值（字号30 / 透明度0.05 / 间隙160 / 行距5 / 角度-45°）',
      success: r => {
        if (r.confirm) {
          this.setData({
            wmFontPx: DEFAULT_WM_STYLE.fontPx,
            wmAlpha: DEFAULT_WM_STYLE.alpha,
            wmGapX: DEFAULT_WM_STYLE.gapX,
            wmLineMul: DEFAULT_WM_STYLE.lineMul,
            wmAngle: DEFAULT_WM_STYLE.angle
          })
        }
      }
    })
  },

  onSaveWmStyle() {
    if (this.data.wmStyleSaving) return
    // 组装 JSON（用 clamp 后的值，确保落库合法）
    const style = {
      fontPx: this._clampNum(this.data.wmFontPx, 'fontPx'),
      alpha: this._clampNum(this.data.wmAlpha, 'alpha'),
      gapX: this._clampNum(this.data.wmGapX, 'gapX'),
      lineMul: this._clampNum(this.data.wmLineMul, 'lineMul'),
      angle: this._clampNum(this.data.wmAngle, 'angle')
    }
    const json = JSON.stringify(style)
    if (json === this.data.wmStyleInitial) {
      wx.showToast({ icon: 'none', title: '没有变化' })
      return
    }
    this.setData({ wmStyleSaving: true })
    this._callSet('pdfWatermarkStyle', json).then(() => {
      this.setData({ wmStyleInitial: json, wmStyleSaving: false })
      wx.showToast({ icon: 'success', title: '已保存' })
    }).catch(msg => {
      this.setData({ wmStyleSaving: false })
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
