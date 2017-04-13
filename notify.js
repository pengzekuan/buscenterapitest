var axios = require('axios');
var json2xml = require('json2xml');
var api = require('./config/api');

var paySuccess = {
  xml: {
    bank_type: 'CFT',
    charset: 'UTF-8',
    fee_type: 'CNY',
    is_subscribe: 'N',
    mch_id: '8712200007',
    nonce_str: '1483200084815',
    openid: 'oSp4hs-00mj6RDEAYarPm8KRPlcI',
    out_trade_no: 'test150742',
    out_transaction_id: '4004542001201612314676691574',
    pay_result: 0,
    result_code: 0,
    sign: 'FA55E7FB38D5125D11767EA031C8602B',
    sign_type: 'MD5',
    status: 0,
    sub_appid: 'wx83db88e6adf42c36',
    sub_is_subscribe: 'Y',
    sub_openid: 'oSp4hs6aT40eREkvcMaqB7UKlBUw',
    time_end: '20170101000124',
    total_fee: 5300,
    trade_type: 'pay.weixin.jspay',
    transaction_id: '8711410001201612317089540276',
    version: '2.0'
  }
}

// 模拟支付通知
log('支付通知');
notify(paySuccess, 1);


function notify(paySuccess, count) {
  log('通知次数：' + count);
  if(count >= 10) {
    throw new CenterException('支付通知超时');
  }
  axios.post(api.WECHAT_NOTIFY, json2xml(paySuccess)
  , {
    'headers': {
      'Content-Type': 'application/xml',
    }
  }).then(function(res) {
    log(res.data);
    if(res.data == 'fail') {
      // 重复
      log('通知失败，重新通知');
      return notify(paySuccess, count+1);
    }

    log('支付成功');
  }).catch(onError);
}

function log() {
  console.log(...arguments);
}

function CenterException(message) {
  this.name = 'AppException';
  this.message = message;
}

function onError(err) {
  // log(err);
  log(err.name + ':' + err.message);
}
