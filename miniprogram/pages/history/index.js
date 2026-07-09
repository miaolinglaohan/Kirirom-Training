// pages/history/index.js
const app = getApp()

Page({
  data: {
    items: []
  },

  onLoad() {
    // 实际加载由 onShow 触发（先过身份守卫）
  },

  onShow() {
    app.guardAuth().then(emp => {
      if (!emp) return
      const openid = app.globalData.openid
      if (openid) {
        this.query(openid)
      }
    })
  },

  query(openid) {
    const db = wx.cloud.database()
    const _ = db.command
    // "我的成绩"展示正式考试 + 刷题记录；过滤掉模拟考试记录，避免污染考试成绩列表。
    // 这里不直接 orderBy createTime：旧数据里有 2026/06/28 与 2026-07-09 混用，
    // 字符串排序会乱，统一拉回后按解析出的时间戳排序。
    db.collection('historys').where({
      _openid: openid
    }).limit(100).get({
      success: async res => {
        const raw = (res.data || [])
          .filter(item => item.isPractice === true || item.isMock !== true)
        const maps = await this.loadNameMaps(db, _, raw)
        const items = raw
          .map(item => this.decorateItem(item, maps))
          .sort((a, b) => b._timeMs - a._timeMs)
          .slice(0, 5)
        this.setData({ items })
      },
      fail: err => {
        wx.showToast({ icon: 'none', title: '查询记录失败' })
        console.error('[历史] 查询失败：', err)
      }
    })
  },

  async loadNameMaps(db, _, items) {
    const assessmentIds = []
    const subjectIds = []
    items.forEach(item => {
      if (item.assessmentId) assessmentIds.push(item.assessmentId)
      const sid = this.extractPracticeSubjectId(item)
      if (sid) subjectIds.push(sid)
    })
    const maps = { assessments: {}, subjects: {} }
    const uniqAssessments = Array.from(new Set(assessmentIds)).filter(Boolean)
    const uniqSubjects = Array.from(new Set(subjectIds)).filter(Boolean)
    if (uniqAssessments.length > 0) {
      try {
        const res = await db.collection('assessments')
          .where({ _id: _.in(uniqAssessments) })
          .field({ name: true, title: true })
          .limit(100)
          .get()
        ;(res.data || []).forEach(a => {
          maps.assessments[a._id] = a.name || a.title || ''
        })
      } catch (e) {
        console.warn('[history] assessment name lookup failed', e)
      }
    }
    if (uniqSubjects.length > 0) {
      try {
        const res = await db.collection('subjects')
          .where({ _id: _.in(uniqSubjects) })
          .field({ name: true })
          .limit(100)
          .get()
        ;(res.data || []).forEach(s => {
          maps.subjects[s._id] = s.name || ''
        })
      } catch (e) {
        console.warn('[history] subject name lookup failed', e)
      }
    }
    return maps
  },

  decorateItem(item, maps) {
    const timeMs = this.resolveTimeMs(item)
    const date = timeMs ? this.formatDate(timeMs) : String(item.createTime || '').substr(0, 10)
    const total = item.total || (Array.isArray(item.items) ? item.items.length : 0)
    const hasFull = typeof item.fullScore === 'number' && item.fullScore > 0
    const score = typeof item.score === 'number' ? item.score : (item.rightNum || 0)
    const fullScore = hasFull ? item.fullScore : total
    item._timeMs = timeMs || 0
    item._dateText = date
    item._scoreDisplay = score + '/' + fullScore + ' 分'
    item._right = item.rightNum || 0
    item._total = total
    item._displayName = this.resolveDisplayName(item, maps)
    return item
  },

  resolveTimeMs(item) {
    if (typeof item.createTimeMs === 'number') return item.createTimeMs
    if (item.submittedAt) {
      const submitted = new Date(item.submittedAt).getTime()
      if (Number.isFinite(submitted)) return submitted
    }
    const s = String(item.createTime || '').trim()
    if (!s) return 0
    const normalized = s.replace(/\//g, '-')
    let t = new Date(normalized).getTime()
    if (Number.isFinite(t)) return t
    const m = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
    if (!m) return 0
    const d = new Date(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)
    )
    return d.getTime()
  },

  formatDate(ms) {
    const d = new Date(ms)
    const pad = n => (n < 10 ? '0' + n : '' + n)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  },

  resolveDisplayName(item, maps) {
    if (item.isPractice === true) {
      const sid = this.extractPracticeSubjectId(item)
      const subjectName = item.practiceSubjectName
        || (sid && maps.subjects[sid])
        || this.subjectNameOf(item)
        || '题库'
      return subjectName.indexOf('刷题') >= 0 ? subjectName : subjectName + '刷题'
    }
    return item.displayName
      || item.assessmentName
      || (item.assessmentId && maps.assessments[item.assessmentId])
      || this.subjectNameOf(item)
      || '考试'
  },

  extractPracticeSubjectId(item) {
    if (item.practiceSubjectId) return item.practiceSubjectId
    if (item.question) {
      try {
        const q = typeof item.question === 'string' ? JSON.parse(item.question) : item.question
        if (q && q.id) return q.id
      } catch (e) {}
    }
    if (item.subject && typeof item.subject === 'object' && item.subject._id) return item.subject._id
    return ''
  },

  subjectNameOf(item) {
    if (!item.subject) return ''
    if (typeof item.subject === 'string') return item.subject
    return item.subject.name || ''
  },

  toReviewPage(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/review/review?id=' + id })
  },

  toModePage(e) {
    wx.setStorageSync('arr', JSON.parse(e.currentTarget.dataset.questions))
    wx.redirectTo({ url: '/pages/look/index' })
  },

  toAttendPage(e) {
    const id = e.currentTarget.dataset.id
    const title = e.currentTarget.dataset.title
    wx.navigateTo({ url: '/pages/question/index?id=' + id + '&title=' + title })
  }
})
