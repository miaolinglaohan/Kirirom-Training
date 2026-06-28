// pages/examSchedule/index.js
const app = getApp()

Page({
  data: {
    loading: true,
    list: [],          // 摸底考试列表（已加工，含 status/statusText/...）
    serverOffset: 0    // 服务端时间偏移（仅用于本地倒计时显示，不影响判定）
  },

  onLoad() {
    this.refresh()
    this.startTick()
  },

  onShow() {
    this.refresh()
  },

  onUnload() {
    this.stopTick()
  },

  refresh() {
    wx.cloud.callFunction({
      name: 'listMyAssessments',
      data: { onlyActive: false }
    }).then(res => {
      const r = res.result || {}
      if (!r.ok) {
        console.error('[examSchedule] 后端拒绝', r)
        this.setData({ loading: false, list: [] })
        if (r.code !== 'UNACTIVATED') {
          wx.showToast({ icon: 'none', title: r.message || '加载失败' })
        }
        return
      }
      this.setData({
        loading: false,
        serverOffset: (r.now || Date.now()) - Date.now(),
        list: this.decorate(r.list || [])
      })
    }).catch(err => {
      console.error('[examSchedule] 云函数失败', err)
      this.setData({ loading: false, list: [] })
      wx.showToast({ icon: 'none', title: '网络异常' })
    })
  },

  // 给每条考试加上展示用字段
  decorate(list) {
    const now = Date.now() + this.data.serverOffset
    return list.map(item => {
      const start = item.startMs || new Date(item.startTime || 0).getTime()
      const end = item.endMs || (start + (item.duration || 0) * 60 * 1000)
      // 服务端已计算 status，但本地 1 秒一跳时也要重算（应对时间穿越）
      let status = item.status
      if (now < start) status = 'pending'
      else if (now <= end) status = 'ongoing'
      else status = 'expired'

      let statusText, canEnter = false
      if (status === 'pending') statusText = '未开考'
      else if (status === 'ongoing') { statusText = '进行中'; canEnter = true }
      else statusText = '已截止'

      return {
        ...item,
        startTimeText: start ? this.fmtTime(start) : '',
        endTimeText: end ? this.fmtTime(end) : '',
        countdownText: this.fmtCountdown(start - now),
        status,
        statusText,
        canEnter
      }
    })
  },

  fmtTime(ts) {
    const d = new Date(ts)
    const pad = n => (n < 10 ? '0' + n : '' + n)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  },

  fmtCountdown(ms) {
    if (ms <= 0) return '00:00:00'
    const totalSec = Math.floor(ms / 1000)
    const d = Math.floor(totalSec / 86400)
    const h = Math.floor((totalSec % 86400) / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    const pad = n => (n < 10 ? '0' + n : '' + n)
    if (d > 0) return `${d} 天 ${pad(h)}:${pad(m)}:${pad(s)}`
    return `${pad(h)}:${pad(m)}:${pad(s)}`
  },

  // —— 倒计时刷新 ——
  startTick() {
    this.stopTick()
    this.tickTimer = setInterval(() => {
      // 保留服务端给的原始字段（startMs/endMs/...），剥离展示衍生字段后重新 decorate
      const decorated = this.decorate(this.data.list.map(it => {
        const { startTimeText, endTimeText, countdownText, statusText, canEnter, ...rest } = it
        return rest
      }))
      this.setData({ list: decorated })
    }, 1000)
  },

  stopTick() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
  },

  // 点击某条考试
  onTapExam(e) {
    const item = e.currentTarget.dataset.item
    if (item.status === 'pending') {
      wx.showToast({ icon: 'none', title: '考试尚未开始' })
      return
    }
    if (item.status === 'expired') {
      wx.showToast({ icon: 'none', title: '考试已截止' })
      return
    }
    // ongoing：跳转考场，enterExam 会再校验一次
    wx.navigateTo({
      url: '/pages/exam/exam?assessmentId=' + encodeURIComponent(item._id)
    })
  }
})
