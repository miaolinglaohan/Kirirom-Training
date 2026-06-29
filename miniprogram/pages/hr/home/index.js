// pages/hr/home/index.js
//
// HR 管理后台首页：4 入口卡片 + admin 系统设置卡 + （临时）PDF 测试入口。
// 任何非 HR 进入此页都自动 reLaunch 回普通首页（双保险，前端 + 云函数都拦）。

const app = getApp()
const pdfCanvas = require('../../../utils/pdf/pdfCanvas')
const pdfExport = require('../../../utils/pdf/pdfExport')

Page({
  data: {
    me: null,
    testing: false  // PDF 测试按钮 loading
  },

  onShow() {
    app.guardAuth().then(emp => {
      if (!emp) return
      if (emp.role !== 'hr' && emp.role !== 'admin') {
        wx.showToast({ icon: 'none', title: '无权访问管理后台' })
        setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 800)
        return
      }
      this.setData({ me: emp })
    })
  },

  goEmployees() { wx.navigateTo({ url: '/pages/hr/employees/index' }) },
  goAssessments() { wx.navigateTo({ url: '/pages/hr/assessments/index' }) },
  goSubjects() { wx.navigateTo({ url: '/pages/hr/subjects/index' }) },
  goQuestions() { wx.navigateTo({ url: '/pages/hr/subjects/index' }) },
  goSettings() { wx.navigateTo({ url: '/pages/hr/settings/index' }) },

  // -------------------------------------------------------------------------
  // 临时：M2 PDF 容器自测入口
  // 流程：取水印 → 拿隐藏 canvas → 画 2 页 demo → 导出 + 预览
  // 验收点：
  //   (1) 预览能打开；
  //   (2) 文件大小 < 800KB；
  //   (3) 水印为斜向半透明文字 / 未配置时空白。
  // -------------------------------------------------------------------------

  /** 通过 createSelectorQuery 拿到 type=2d 的 canvas node。 */
  _getTestCanvasNode() {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery().in(this)
        .select('#pdfTestCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (res && res[0] && res[0].node) resolve(res[0].node)
          else reject(new Error('找不到 #pdfTestCanvas（请确认 WXML 含隐藏 canvas）'))
        })
    })
  },

  /** 从 sysConfig 读 pdfWatermark；失败或空都返回 ''。 */
  async _loadWatermark() {
    try {
      const r = await wx.cloud.callFunction({
        name: 'hrSysConfig',
        data: { action: 'get', key: 'pdfWatermark' }
      })
      if (r && r.result && !r.result.error) return r.result.value || ''
    } catch (e) {
      console.warn('[testPdf] load watermark fail, fallback empty:', e)
    }
    return ''
  },

  async onTestPdf() {
    if (this.data.testing) return
    this.setData({ testing: true })
    wx.showLoading({ title: '生成 PDF…', mask: true })
    try {
      // 1) 读水印
      const watermark = await this._loadWatermark()

      // 2) 拿 canvas
      const canvas = await this._getTestCanvasNode()

      // 3) 渲染 2 页
      const pages = []
      for (let i = 1; i <= 2; i++) {
        const { ctx, widthPx, heightPx, pageW, pageH } = pdfCanvas.prepareCanvas(canvas)
        pdfCanvas.drawWhiteBg(ctx, widthPx, heightPx)

        // 标题区
        ctx.save()
        ctx.fillStyle = '#1a1a1a'
        ctx.font = 'bold 56px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('PDF 容器自测', widthPx / 2, 180)
        ctx.font = '28px sans-serif'
        ctx.fillStyle = '#666'
        ctx.fillText('A4 portrait · 144 DPI · 半透明斜向水印', widthPx / 2, 240)

        // 信息块（带蓝色边框）
        ctx.strokeStyle = '#2d8cf0'
        ctx.lineWidth = 4
        ctx.strokeRect(100, 330, widthPx - 200, 360)

        ctx.fillStyle = '#1a1a1a'
        ctx.font = '32px sans-serif'
        ctx.textAlign = 'left'
        let y = 400
        const lineH = 60
        const meName = (this.data.me && this.data.me.name) || '-'
        const meRole = (this.data.me && this.data.me.role) || '-'
        ctx.fillText('页码：' + i + ' / 2', 140, y); y += lineH
        ctx.fillText('生成时间：' + new Date().toLocaleString(), 140, y); y += lineH
        ctx.fillText('当前用户：' + meName + ' (' + meRole + ')', 140, y); y += lineH
        ctx.fillText('水印文本：' + (watermark || '（未配置）'), 140, y); y += lineH
        ctx.fillText('画布像素：' + widthPx + ' × ' + heightPx, 140, y)

        // 页脚
        ctx.fillStyle = '#999'
        ctx.font = '24px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('— exam-mini · v0.3.5-pdf-core 自测 —', widthPx / 2, heightPx - 80)
        ctx.restore()

        // 水印（最上层）
        pdfCanvas.drawWatermark(ctx, watermark, widthPx, heightPx)

        // 转 JPEG
        const jpeg = await pdfCanvas.canvasToJpegBytes(canvas, { quality: 0.85 })
        pages.push({ jpeg, imgW: widthPx, imgH: heightPx, pageW, pageH })
      }

      // 4) 导出 + 预览
      const fileName = 'pdf_test_' + Date.now() + '.pdf'
      wx.hideLoading()
      const fp = await pdfExport.exportAndPreview(pages, fileName)
      console.log('[testPdf] saved at', fp)
    } catch (e) {
      wx.hideLoading()
      console.error('[testPdf]', e)
      wx.showModal({
        title: 'PDF 测试失败',
        content: (e && e.message) || String(e),
        showCancel: false
      })
    } finally {
      this.setData({ testing: false })
    }
  }
})
