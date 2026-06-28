// cloudfunctions/getServerTime/index.js
//
// 用途：返回服务端当前时间。考试页倒计时和「考试是否已开考」判断都基于这个时间，
//      杜绝前端通过修改设备时间来作弊。
//
// 入参：无
// 返回：{ now: <number, 毫秒时间戳> }

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async () => {
  return { now: Date.now() }
}
