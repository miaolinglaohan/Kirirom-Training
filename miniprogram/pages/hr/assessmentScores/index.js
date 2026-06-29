const app = getApp()
const pdfCanvas = require('../../../utils/pdf/pdfCanvas')
const pdfExport = require('../../../utils/pdf/pdfExport')
const pdfScoreSheet = require('../../../utils/pdf/pdfScoreSheet')
const pdfAnswerSheet = require('../../../utils/pdf/pdfAnswerSheet')

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  const pad = n => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const STATUS_LABEL = {
  submitted:   { text: '已交卷', cls: 'submitted' },
  in_progress: { text: '答题中', cls: 'progress' },
  absent:      { text: '缺考',   cls: 'absent' }
}

const TABS = [
  { key: 'all',         label: '全部' },
  { key: 'submitted',   label: '已交卷' },
  { key: 'in_progress', label: '答题中' },
  { key: 'absent',      label: '缺考' }
]

Page({
  data: {
    assessmentId: '',
    loading: true,
    assessment: null,
    meta: '',
    summary: { expected: 0, submitted: 0, inProgress: 0, absent: 0, avgScore: null },
    avgScoreText: '—',
    tabs: TABS,
    activeTab: 'all',
    applicants: [],     // 原始列表（来自云函数）
    visibleList: [],    // 按 tab 过滤后的渲染列表
    exporting: false,   // 导出总分单 PDF 时的 loading 态
    exportingAll: false, // 导出全员答卷 PDF 时的 loading 态
    canExportAll: false  // 是否允许导出全员答卷（已交卷 tab + 有已交卷数据）
  },

  onLoad(opt) {
    const id = (opt && opt.id) || ''
    if (!id) {
      wx.showToast({ icon: 'none', title: '缺少考试 ID' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.setData({ assessmentId: id })
  },

  onShow() {
    if (!this.data.assessmentId) return
    app.guardAuth().then(emp => {
      if (!emp) return
      if (emp.role !== 'hr' && emp.role !== 'admin') {
        wx.showToast({ icon: 'none', title: '无权访问' })
        setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 800)
        return
      }
      this.setData({ me: emp })
      this.loadScores()
    })
  },

  loadScores() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'hrListAssessmentScores',
      data: { assessmentId: this.data.assessmentId }
    }).then(res => {
      const r = res.result || {}
      if (!r.ok) {
        wx.showToast({ icon: 'none', title: r.message || '加载失败' })
        this.setData({ loading: false })
        return
      }
      const a = r.assessment || {}
      const meta = [
        '开考 ' + fmtTime(a.startTime),
        '时长 ' + (a.duration || 0) + 'min',
        '题量 ' + (a.totalQuestions || 0),
        '满分 ' + (a.fullScore || 0)
      ].join(' · ')

      const applicants = (r.applicants || []).map(p => {
        const sl = STATUS_LABEL[p.status] || { text: p.status, cls: '' }
        return Object.assign({}, p, {
          statusText: sl.text,
          statusCls: sl.cls,
          scoreText: p.status === 'submitted' && p.score != null
            ? p.score + ' / ' + (p.fullScore || 0)
            : '',
          submittedAtText: p.submittedAt ? fmtTime(p.submittedAt) : '',
          startedAtText: p.startedAt ? fmtTime(p.startedAt) : ''
        })
      })

      const summary = r.summary || { expected: 0, submitted: 0, inProgress: 0, absent: 0, avgScore: null }
      const avgScoreText = summary.avgScore == null ? '—' : String(summary.avgScore)

      this.setData({
        loading: false,
        assessment: a,
        meta,
        summary,
        avgScoreText,
        applicants
      }, () => this.applyFilter())
    }).catch(err => {
      console.error('[assessmentScores] 加载失败', err)
      wx.showToast({ icon: 'none', title: '网络异常' })
      this.setData({ loading: false })
    })
  },

  onTabTap(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.activeTab) return
    this.setData({ activeTab: key }, () => this.applyFilter())
  },

  applyFilter() {
    const k = this.data.activeTab
    const list = k === 'all'
      ? this.data.applicants
      : this.data.applicants.filter(p => p.status === k)
    // 全员答卷导出按钮：在「全部」或「已交卷」tab 下，只要有已交卷数据就启用
    // （「答题中」「缺考」tab 下置灰，避免误以为可以导出未交卷的）
    const submittedCount = this.data.applicants.filter(p => p.status === 'submitted').length
    const canExportAll = (k === 'all' || k === 'submitted') && submittedCount > 0
    this.setData({ visibleList: list, canExportAll })
  },

  // 点击已交卷条目 → 跳转 HR 复盘页（v0.3.4 起接入）
  // 答题中 / 缺考仍 toast 提示，无内容可复盘
  onTapApplicant(e) {
    const idx = e.currentTarget.dataset.idx
    const p = this.data.visibleList[idx]
    if (!p) return
    if (p.status === 'submitted') {
      if (!p.enrollmentId) {
        wx.showToast({ icon: 'none', title: '该记录缺少 enrollmentId' })
        return
      }
      wx.navigateTo({
        url: '/pages/hr/applicantReview/index?id=' + encodeURIComponent(p.enrollmentId)
      })
    } else if (p.status === 'in_progress') {
      wx.showToast({ icon: 'none', title: p.name + ' 答题进行中' })
    } else {
      wx.showToast({ icon: 'none', title: p.name + ' 未参加考试' })
    }
  },

  onPullDownRefresh() {
    this.loadScores()
    wx.stopPullDownRefresh()
  },

  // -------------------------------------------------------------------------
  // 导出 PDF · 本场总分单
  // 流程：读水印 → 拿 canvas → 调 pdfScoreSheet 渲染 → exportAndPreview
  // -------------------------------------------------------------------------

  _getPdfCanvasNode() {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery().in(this)
        .select('#pdfCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (res && res[0] && res[0].node) resolve(res[0].node)
          else reject(new Error('找不到 #pdfCanvas'))
        })
    })
  },

  async _loadSysConfig(key) {
    try {
      const r = await wx.cloud.callFunction({
        name: 'hrSysConfig',
        data: { action: 'get', key: key }
      })
      if (r && r.result && !r.result.error) return r.result.value || ''
    } catch (e) {
      console.warn('[scores.exportPdf] load sysConfig fail, key=' + key + ':', e)
    }
    return ''
  },

  async onExportPdf() {
    if (this.data.exporting) return
    if (!this.data.assessment) {
      wx.showToast({ icon: 'none', title: '考试数据未加载' })
      return
    }
    this.setData({ exporting: true })
    wx.showLoading({ title: '生成 PDF…', mask: true })
    try {
      const [watermark, unitName] = await Promise.all([
        this._loadSysConfig('pdfWatermark'),
        this._loadSysConfig('unitName')
      ])
      const canvas = await this._getPdfCanvasNode()

      const a = this.data.assessment || {}

      // 考试日期文本（YYYY年M月D日）— 用 startTime 派生，不存库
      let examDateText = ''
      if (a.startTime) {
        const d = new Date(a.startTime)
        if (!isNaN(d.getTime())) {
          examDateText = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日'
        }
      }

      const pages = await pdfScoreSheet.buildScoreSheetPages(canvas, {
        assessment: {
          name:           a.name || '',
          startTimeText:  fmtTime(a.startTime),
          duration:       a.duration || 0,
          totalQuestions: a.totalQuestions || 0,
          fullScore:      a.fullScore || 0
        },
        applicants:   this.data.applicants,  // pdfScoreSheet 内部会按 status==='submitted' 过滤
        watermark:    watermark,
        unitName:     unitName,
        examDateText: examDateText,
        generatedBy:  (this.data.me && this.data.me.name) || ''
      })

      // 文件名 = 考试名 + 总分单 + 时间戳
      const safeName = (a.name || 'assessment').replace(/[\\/:*?"<>|\s]/g, '_')
      const fileName = safeName + '_总分单_' + Date.now() + '.pdf'
      wx.hideLoading()
      const fp = await pdfExport.exportAndPreview(pages, fileName)
      console.log('[scores.exportPdf] saved at', fp)
    } catch (e) {
      wx.hideLoading()
      console.error('[scores.exportPdf]', e)
      wx.showModal({
        title: 'PDF 导出失败',
        content: (e && e.message) || String(e),
        showCancel: false
      })
    } finally {
      this.setData({ exporting: false })
    }
  },

  // -------------------------------------------------------------------------
  // 导出 PDF · 全员答卷（仅「已交卷」tab 下可用）
  // 串行调云函数 hrGetApplicantReview 取每个人的完整答卷数据，
  // 然后一次性交给 pdfAnswerSheet.buildBatchAnswerSheetPages 渲染。
  // 每人独立分页 + 换人强制换页；全局连续页码；末页单一落款。
  // -------------------------------------------------------------------------
  async onExportAllAnswers() {
    if (this.data.exporting || this.data.exportingAll) return
    if (!this.data.canExportAll) {
      wx.showToast({ icon: 'none', title: '暂无已交卷数据' })
      return
    }
    if (!this.data.assessment) {
      wx.showToast({ icon: 'none', title: '考试数据未加载' })
      return
    }
    const submittedList = (this.data.applicants || []).filter(p => p.status === 'submitted')
    if (submittedList.length === 0) {
      wx.showToast({ icon: 'none', title: '暂无已交卷数据' })
      return
    }

    // 大批量警告（粗略阈值：>20 人提示一下，避免误操作生成几十兆 PDF）
    if (submittedList.length > 20) {
      const confirmRes = await new Promise(resolve => {
        wx.showModal({
          title: '确认导出',
          content: '即将导出 ' + submittedList.length + ' 人答卷，可能生成较大 PDF（数十 MB），耗时可能较长。是否继续？',
          confirmText: '继续',
          cancelText: '取消',
          success: r => resolve(!!r.confirm),
          fail: () => resolve(false)
        })
      })
      if (!confirmRes) return
    }

    this.setData({ exportingAll: true })
    wx.showLoading({ title: '拉取数据 0/' + submittedList.length, mask: true })

    try {
      // 1) 串行拉取每人的答卷数据
      const persons = []
      for (let i = 0; i < submittedList.length; i++) {
        const item = submittedList[i]
        wx.showLoading({ title: '拉取数据 ' + (i + 1) + '/' + submittedList.length, mask: true })
        if (!item.enrollmentId) {
          console.warn('[exportAllAnswers] 跳过缺少 enrollmentId 的条目:', item.name)
          continue
        }
        const r = await wx.cloud.callFunction({
          name: 'hrGetApplicantReview',
          data: { enrollmentId: item.enrollmentId }
        })
        const res = (r && r.result) || {}
        if (!res.ok) {
          console.warn('[exportAllAnswers] 拉取失败，跳过:', item.name, res.message)
          continue
        }
        const questions = res.questions || []
        const userAnswers = res.userAnswers || {}
        const officialMap = {}
        ;(res.answersOfficial || []).forEach(a => {
          officialMap[a.qid] = (a.correctCodes || []).map(c => String(c).toUpperCase())
        })
        const rightFlags = questions.map(q => {
          const u = (userAnswers[q._id] || [])
          const uSorted = (Array.isArray(u) ? u : [u])
            .map(c => String(c).toUpperCase()).filter(Boolean).sort().join(',')
          const o = (officialMap[q._id] || []).slice().sort().join(',')
          return uSorted !== '' && uSorted === o
        })
        persons.push({
          employee: {
            name: (res.employee && res.employee.name) || item.name || '',
            dept: (res.employee && res.employee.dept) || item.dept || '',
            role: (res.employee && res.employee.role) || item.role || 'employee'
          },
          enrollment: {
            score:           (res.enrollment && res.enrollment.score) || 0,
            fullScore:       (res.enrollment && res.enrollment.fullScore) || 0,
            rightNum:        (res.enrollment && res.enrollment.rightNum) || 0,
            total:           (res.enrollment && res.enrollment.total) || questions.length,
            submittedAtText: fmtTime(res.enrollment && res.enrollment.submittedAt),
            switchCount:     (res.enrollment && res.enrollment.switchCount) || 0,
            isMock:          !!(res.enrollment && res.enrollment.isMock)
          },
          questions, userAnswers, officialMap, rightFlags
        })
      }

      if (persons.length === 0) {
        wx.hideLoading()
        wx.showToast({ icon: 'none', title: '没有可导出的答卷' })
        return
      }

      // 2) 共享水印、单位名、考试日期
      const [watermark, unitName] = await Promise.all([
        this._loadSysConfig('pdfWatermark'),
        this._loadSysConfig('unitName')
      ])
      const a = this.data.assessment || {}
      let examDateText = ''
      if (a.startTime) {
        const d = new Date(a.startTime)
        if (!isNaN(d.getTime())) {
          examDateText = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日'
        }
      }

      // 3) 渲染
      const canvas = await this._getPdfCanvasNode()
      wx.showLoading({ title: '生成 PDF…', mask: true })
      const pages = await pdfAnswerSheet.buildBatchAnswerSheetPages(canvas, {
        assessment:   { name: a.name || '' },
        persons:      persons,
        watermark:    watermark,
        unitName:     unitName,
        examDateText: examDateText,
        generatedBy:  (this.data.me && this.data.me.name) || '',
        onProgress: (cur, total) => {
          wx.showLoading({ title: '生成 PDF ' + cur + '/' + total, mask: true })
        }
      })

      // 4) 落盘 + 预览
      const safeName = (a.name || 'assessment').replace(/[\\/:*?"<>|\s]/g, '_')
      const fileName = safeName + '_全员答卷_' + Date.now() + '.pdf'
      wx.hideLoading()
      const fp = await pdfExport.exportAndPreview(pages, fileName)
      console.log('[exportAllAnswers] saved at', fp)
    } catch (e) {
      wx.hideLoading()
      console.error('[exportAllAnswers]', e)
      wx.showModal({
        title: 'PDF 导出失败',
        content: (e && e.message) || String(e),
        showCancel: false
      })
    } finally {
      this.setData({ exportingAll: false })
    }
  }
})
