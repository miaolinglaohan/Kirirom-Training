// pages/simple/index.js
const util = require('../../utils/util.js')
const app = getApp()
console.log('a00');
console.log(app.globalData.userInfo);

Page({

  /**
   * 页面的初始数据
   */
  data: {
    openid: '',
    idx: 0,
    buttontext: '下一个',
    score: 0,
    score_arr: [],
    code_arr: [],
    total: 0,
    options: []
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad: function (options) {
    let id = options.id;
    if (!id) {
      wx.showToast({ icon: 'none', title: '缺少参数' });
      return;
    }
    this.setData({ id });
    this.loadQuestions(id);
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady: function () {
    
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow: function () {

  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide: function () {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload: function () {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh: function () {

  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom: function () {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage: function () {

  },
  loadQuestions: function(id){
    const db = wx.cloud.database()
    // 先尝试直接查 questions（id 为 subject._id 时直接命中）
    db.collection('questions').where({ examid: id }).get().then(res => {
      let questions = res.data;
      if (questions && questions.length > 0) {
        this._startQuiz(questions);
        return;
      }
      // id 可能是 exam._id，中转查 subjects → 取第一个 subject → 再查 questions
      return db.collection('subjects').where({ pid: id }).get();
    }).then(res => {
      if (!res) return; // 第一次查询已命中
      let subjects = res.data;
      if (!subjects || subjects.length === 0) {
        wx.showToast({ icon: 'none', title: '该题库下暂无科目' });
        return;
      }
      return db.collection('questions').where({ examid: subjects[0]._id }).get();
    }).then(res => {
      if (!res) return;
      let questions = res.data;
      if (!questions || questions.length === 0) {
        wx.showToast({ icon: 'none', title: '该题库下暂无题目' });
        return;
      }
      this._startQuiz(questions);
    }).catch(err => {
      wx.showToast({ icon: 'none', title: '加载题目失败' });
      console.error('[simple] 查询失败: ', err);
    })
  },

  _startQuiz: function(questions){
    let arr = questions.map(q => q._id);
    // 随机打乱
    arr.sort(() => Math.random() - 0.5);
    let total = arr.length;
    // 动态题量：最多 50 题
    if (total > 50) { arr = arr.slice(0, 50); total = 50; }
    let score_arr = new Array(total).fill(0);
    let code_arr = new Array(total).fill('M');
    this.setData({ arr, total, score_arr, code_arr }, () => {
      this.getQuestion(arr[0]);
    });
  },
  radioChange: function(e) {
    let code = e.detail.value;
    let { score_arr, code_arr, idx, question } = this.data;
    let opt = (question.options || []).find(o => o.code === code);
    let point = (opt && parseInt(opt.value) === 1) ? 1 : 0;
    score_arr[idx] = point;
    code_arr[idx] = code;
    let sum = score_arr.reduce((x,y) => x + y, 0);
    wx.setStorageSync('score_arr', score_arr);
    wx.setStorageSync('code_arr', code_arr);
    this.setData({ score_arr, code_arr, score: sum });
  },

  checkboxChange: function(e) {
    let codes = e.detail.value || [];
    let { score_arr, code_arr, idx, question } = this.data;
    // 完全选对才 1 分
    let correctCodes = (question.options || [])
      .filter(o => parseInt(o.value) === 1)
      .map(o => o.code).sort();
    let userSorted = codes.slice().sort();
    let right = correctCodes.length === userSorted.length
      && correctCodes.every((c, i) => c === userSorted[i]);
    score_arr[idx] = right ? 1 : 0;
    code_arr[idx] = codes.join('');
    let sum = score_arr.reduce((x,y) => x + y, 0);
    wx.setStorageSync('score_arr', score_arr);
    wx.setStorageSync('code_arr', code_arr);
    this.setData({ score_arr, code_arr, score: sum });
  },
  onNextTap: function(){
    let _this = this;
    let { score, arr, score_arr, code_arr, idx, question, total } = this.data;
    if(score_arr[idx] == 0){
      this.add(question);
    }
    if(code_arr[idx]=='M'){
      wx.showActionSheet({
        itemList: ['放弃该题', '容我三思'],
        success (res) {
          if(res.tapIndex == 1){ return; }
          else { _this.getNewOne(); }
        },
        fail (res) { console.log(res.errMsg) }
      })
    }else{
      _this.getNewOne();
    }
  },
  add: function(question){
    let {exam ,subject } = this.data;
    // exam/subject 可能未加载，跳过记录
    if (!exam || !subject) return;
    let time = util.formatTime(new Date(Date.now()));
    const db = wx.cloud.database()
    db.collection('record').add({
      data: {
        code: subject.code,
        exam: JSON.stringify(exam),
        subject: JSON.stringify(subject),
        question: JSON.stringify(question),
        createTime: time
      },
      success: res => {
        console.log('[数据库] [新增记录] 成功，记录 _id: ', res._id)
        
      },
      fail: err => {
        wx.showToast({
          icon: 'none',
          title: '新增记录失败'
        })
        console.error('[数据库] [新增记录] 失败：', err)
      }
    })
  },
  getNewOne: function(){
    let { score, arr, score_arr, code_arr, idx, total } = this.data;
    let buttontext = this.data.buttontext;
    idx++;
    if(idx == total - 1){
      buttontext = '提交';
    }
    if(idx == total){
      let sum = score_arr.reduce((x,y)=>x+y);
      this.bindgoscore(sum);
      return;
    }
    this.setData({ idx, buttontext });
    this.getQuestion(arr[idx]);
  },
  bindgoscore: function(score){
    let { total, score_arr, arr } = this.data;
    let rightNum = score_arr.filter(v => v === 1).length;
    let errNum = total - rightNum;
    // 存入全局供 examresult 复盘用
    app.globalData.lastExamResult = {
      isMock: true,
      total, rightNum, errNum,
      score: rightNum, fullScore: total,
      reviewList: []
    };
    let url = '/pages/examresult/examresult?length=' + total
      + '&rightNum=' + rightNum + '&errNum=' + errNum
      + '&ordernum=simple&isMock=1';
    wx.redirectTo({ url: url })
  },
  getQuestion: function(_id){
    const db = wx.cloud.database()
    db.collection('questions').doc(_id).get({
      success: res => {
        console.log('[数据库] [查询记录] 成功: ', res)
        let question = res.data;
        this.setData({
          question: question,
          options: question.options
        })
      },
      fail: err => {
        wx.showToast({
          icon: 'none',
          title: '查询记录失败'
        })
        console.error('[数据库] [查询记录] 失败：', err)
      }
    })
  },
  onGotUserInfo: function(e) {
    let _this = this;
    console.log(e.detail.errMsg)
    console.log(e.detail.userInfo)
    console.log(e.detail.rawData)
    app.globalData.userInfo = e.detail.userInfo;
    setTimeout(function(){
      _this.bindGenerate();
    },1000)
  },
  onGotUserInfo2: function(e) {
    let _this = this;
    console.log(e.detail.errMsg)
    console.log(e.detail.userInfo)
    console.log(e.detail.rawData)
    app.globalData.userInfo = e.detail.userInfo;
    setTimeout(function(){
      _this.bindGenerate2();
    },1000)
  },  
  bindGenerate: function(){
    let question = this.data.question;
    wx.navigateTo({
      url: '/pages/example/index?id='+question.id
    })
  },
  bindGenerate2: function(){
    let question = this.data.question;
    wx.navigateTo({
      url: '/pages/generate/index?id='+question.id
    })
  }
})