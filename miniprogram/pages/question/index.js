// pages/question/index.js
const app = getApp()
Page({

  /**
   * 页面的初始数据
   */
  data: {
    idx: 0,
    score: 0,
    score_arr: [],
    code_arr: [],
    total: 0,
    sortcode: '01'
  },
  radioChange: function(e) {
    let idx = e.currentTarget.dataset.idx;
    let code = e.detail.value;
    let score_arr = this.data.score_arr;
    let code_arr = this.data.code_arr;
    // 单选题：选对得 1 分
    let question = e.currentTarget.dataset.question;
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
    let idx = e.currentTarget.dataset.idx;
    let codes = e.detail.value || [];
    let question = e.currentTarget.dataset.question;
    // 多选：完全选对才得 1 分
    let correctCodes = (question.options || [])
      .filter(o => parseInt(o.value) === 1)
      .map(o => o.code)
      .sort();
    let userSorted = codes.slice().sort();
    let right = correctCodes.length === userSorted.length
      && correctCodes.every((c, i) => c === userSorted[i]);
    let score_arr = this.data.score_arr;
    let code_arr = this.data.code_arr;
    score_arr[idx] = right ? 1 : 0;
    code_arr[idx] = codes.join('');
    let sum = score_arr.reduce((x,y) => x + y, 0);
    wx.setStorageSync('score_arr', score_arr);
    wx.setStorageSync('code_arr', code_arr);
    this.setData({ score_arr, code_arr, score: sum });
  },
  bindSubmitTap: function(){
    let { total, score_arr } = this.data;
    let rightNum = score_arr.filter(v => v === 1).length;
    let errNum = total - rightNum;
    let _this = this;
    wx.showModal({
      showCancel: false,
      title: '温馨提醒',
      content: '您当前得分为：'+ rightNum + ' / ' + total,
      success (res) {
        if (res.confirm) {
          _this.bindgoscore(rightNum, total, errNum);
        }
      }
    })
  },
  bindgoscore: function(rightNum, total, errNum){
    app.globalData.lastExamResult = {
      isMock: true,
      total, rightNum, errNum,
      score: rightNum, fullScore: total,
      reviewList: []
    };
    let url = '/pages/examresult/examresult?length=' + total
      + '&rightNum=' + rightNum + '&errNum=' + errNum
      + '&ordernum=list&isMock=1';
    wx.redirectTo({ url: url })
  },
  /**
   * 生命周期函数--监听页面加载
   */
  onLoad: function (options) {
    console.log(options);
    let id = options.id;
    this.setData({
      id
    });
    this.getQuestions(id);
  },
  getQuestions: function(id){

    
    const db = wx.cloud.database()
    db.collection('questions').where({
      examid: id
    }).get({
      success: res => {
        console.log('[数据库] [查询记录] 成功: ', res)
        let arrayObject = res.data;
        let total = arrayObject.length;
        let arr = [];
        arrayObject.forEach(element => {
          arr.push(element._id);
        });
        let score_arr = new Array(total).fill(0);
        let code_arr = new Array(total).fill('M');
        this.setData({
          questions: arrayObject,
          total,
          score_arr,
          code_arr
        },function(){
          wx.setStorageSync('questions', arrayObject);
          wx.setStorageSync('arr', arr);
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
  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady: function () {
    const pages = getCurrentPages();
    const prevPage = pages[pages.length - 1];
    console.log('开始输出');
    console.log(pages);
    console.log(prevPage);
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

  }

})