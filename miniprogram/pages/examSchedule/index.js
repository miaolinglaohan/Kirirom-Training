// pages/examSchedule/index.js
const app = getApp()

Page({
  data: {
    loading: true,
    list: [],   // 摸底考试列表
    now: 0      // 服务端时间（Phase 2 接入 getServerTime 云函数后替换）
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
    const db = wx.cloud.database()
    const _ = db.command
    // 查找 mode='assessment' 且未截止的考试
    // Phase 0 占位实现：直接查所有 visible 且 mode=assessment 的考试
    db.collection('exam').where({
      mode: 'assessment',
      visible: true
    }).get({
      success: res => {
        this.setData({
          loading: false,
          list: this.decorate(res.data || []),
          now: Date.now()
        })
      },
      fail: err => {
        console.error('[examSchedule] 查询失败', err)
        this.setData({ loading: false, list: [] })
      }
    })
  },

  // 给每条考试加上展示用字段
  decorate(list) {
    const now = Date.now()
    return list.map(item => {
      const start = item.startTime || 0
      const end = item.endTime || 0
      let status, statusText, canEnter = false
      if (now < start) {
        status = 'pending'
        statusText = '未开考'
      } else if (now >= start && now <= end) {
        status = 'ongoing'
        statusText = '进行中'
        canEnter = true
      } else {
        status = 'expired'
        statusText = '已截止'
      }
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
      const decorated = this.decorate(this.data.list.map(it => {
        // 移除展示字段，保留原始数据
        const { startTimeText, endTimeText, countdownText, status, statusText, canEnter, ...rest } = it
        return rest
      }))
      this.setData({ list: decorated, now: Date.now() })
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
    // ongoing：Phase 2 实现进入考场逻辑
    wx.showToast({ icon: 'none', title: '进入考场（待 Phase 2 实现）' })
  }
})
