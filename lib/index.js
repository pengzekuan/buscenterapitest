var co = require('co');
var moment = require('moment');
var axios = require('axios');
var json2xml = require('json2xml');
var program = require('commander');

var cancel = false;
var host = 'http://localhost:8000';
var classDate = moment().format('YYYY-MM-DD');
program
  .version('0.0.1')
  .usage('[options]')
  .option('-c, --cancel', '测试取消订单流程，不输入该选项默认为正常下单流程')
  .option('-u, --host <host>', '测试接口服务器主机地址')
  .option('-d --date [date]', '选择发车时间 格式：YYYY-MM-DD')
  .parse(process.argv);

// console.log('Keywords: ' + program.host);
if(!process.argv.length) {
  program.help();
} else {
  if(program.cancel != undefined) {
    cancel = true;
  }
  if(program.host) {
    host = program.host;
  }
  if(program.date) {
    classDate = program.date;
  }
}

log('当前测试主机服务器地址为：' + host);
log('当前测试流程为：' + (cancel ? '取消下单流程' : '正常下单流程。') );
log('-----------------------');

const CENTER_DOMAIN = host;

const CENTER_ACCESS = CENTER_DOMAIN + '/station/access';

const TEST_LOGIN = CENTER_DOMAIN + '/test/login';

const CENTER_SITES = CENTER_DOMAIN + '/sites';

const WECHAT_NOTIFY = CENTER_DOMAIN + '/wechat/pay/notify';

const ORDER_APPLY = CENTER_DOMAIN + '/user/order/apply';

const ORDER_COMMIT = CENTER_DOMAIN + '/user/order/commit';

const ORDER_PAY = CENTER_DOMAIN + '/wechat/pay';

const ORDER_REFUND_APPLY = CENTER_DOMAIN + '/user/order/refund/apply';

const ORDER_REFUND = CENTER_DOMAIN + '/user/order/refund/done';

const ORDER_CANCEL = CENTER_DOMAIN + '/user/order/cancel';

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

co(function * () {
  log('客运中心接入');
  var accessRes = yield axios.get(CENTER_ACCESS);
  if(!accessRes.data.success) { 
    throw new CenterException('中心接入失败：' + accessRes.data.retMessage);
  }
  log('中心接入成功');

  log('-----------------------');

  log('测试登录')
  var login_res = yield axios.get(TEST_LOGIN);

  var openId = login_res.data.openid;
  // 设置session_id
  var headers = login_res.headers;
  var cookies = headers['set-cookie'];
  axios.defaults.headers.common['Cookie'] = cookies[0];
  log('登录成功', login_res.data);

  log('-----------------------');

  // 选择购买班次
  log('查询目的站点');
  var sitesRes = yield axios.get(CENTER_SITES);
  if(!sitesRes.data.success || !sitesRes.data.list) {
    throw new CenterException('中心获取站点数据失败');
  }
  var sites = sitesRes.data.list;

  log('-----------------------');
  var classes = [];
  var index = 0;
  while( (!classes.length) && (index < sites.length - 1) ) {
    index ++;
    var checkedSite = sites[index];
    // log( '选择目的站点', JSON.stringify(checkedSite));
    // 查询班次
    log('查询班次 => 目的地' + checkedSite.name + ', 发车日期' + classDate);
    var classesRes = yield axios.post(CENTER_DOMAIN + '/station/tickets/' + checkedSite.stationId, {
      finishSite: checkedSite.name,
      classDate: classDate
    });
    if(!classesRes.data.success) {
      throw new CenterException('中心查询班次失败。');
    }
    classes = classesRes.data.tickets;

    // 过滤不可购买班次
    classes = classes.filter(function(c) {
      var road = c.road.find(function(r) {
        return r.finish;
      });
      return c.remSeat && road.canSale;
    });
  }

  if(!classes.length) {
    log('没有发车日期为：' + classDate + '的班次，请重新选择发车日期');
    return;
  }
  log('选择购买班次');
  var classBuy = classes[0];
  log(classBuy);

  // 订单申请
  log('-----------------------');
  log('申请订单')
  var applyRes = yield axios.post(ORDER_APPLY, {
    stationId: checkedSite.stationId,
    classId: classBuy.id,
    siteName: checkedSite.name,
    lockTicketCount: 1
  });
  if(!applyRes.data.success) {
    throw new CenterException('订单申请失败：' + applyRes.data.retMessage);
  }

  var orderId = applyRes.data.result.orderId;
  log('订单申请成功，订单号为：' + orderId);

  log('-----------------------');
  log('提交订单：')
  // 提交订票信息
  var commitRes = yield axios.post(ORDER_COMMIT, {
    orderId: orderId,
    isInsurance: false,
    tickets: {
      adult: 1,
      child: 0,
      free: 0
    },
    cursters: [
      {
        name: '彭泽宽',
        card: '530381199003180510',
        cardType: 0,
        phone: '18313837353'
      }
    ]
  });
  if(!commitRes.data.success) {
    throw new CenterException('提交订单失败：' + commitRes.data.retMessage);
  }
  log('订单:' + orderId + '提交成功');

  log('-----------------------');
  log('生成支付链接');
  var payRes = yield axios.post(ORDER_PAY, {
    data: {
      out_trade_no: orderId,
      body: '班次：' + classBuy.id + ',线路：' + classBuy.orginName + '-' + classBuy.finishName
    }
  });
  if(!payRes.data.success) {
    throw new CenterException('生成支付链接失败：' + payRes.data.message);
  }
  log('生成支付链接：' + payRes.data.res_url);

  // 查询订单
  log('-----------------------');
  log('查询订单');
  var orderRes = yield axios.get(CENTER_DOMAIN + '/user/order/detail/' + orderId);
  if(!orderRes.data.success) {
    throw new CenterException('订单查询失败：' + orderRes.data.retMessage);
  }
  var order = orderRes.data.result;
  log(JSON.stringify(order));

  // 分流 取消／支付
  // var random = Math.round(Math.random());
  if(cancel) {
    log('-----------------------');
    log('取消订单')
    // 取消订单
    var cancelRes = yield axios.post(ORDER_CANCEL, {
      orderId: orderId
    });
    if(!cancelRes.data.success) {
      throw new CenterException('取消订单失败:' + cancelRes.data.retMessage);
    }
    log('订单取消成功。');
    return ;
  }

  // 模拟支付数据
  var paySuccess = {
    xml: {
      bank_type: 'CFT',
      charset: 'UTF-8',
      fee_type: 'CNY',
      is_subscribe: 'N',
      mch_id: '8712200007',
      nonce_str: '1483200084815',
      openid: openId,
      out_trade_no: 'test' + orderId,
      out_transaction_id: '4004542001201612314676691574',
      pay_result: 0,
      result_code: 0,
      sign: 'FA55E7FB38D5125D11767EA031C8602B',
      sign_type: 'MD5',
      status: 0,
      sub_appid: 'wx83db88e6adf42c36',
      sub_is_subscribe: 'Y',
      sub_openid: 'oSp4hs6aT40eREkvcMaqB7UKlBUw',
      time_end: moment().valueOf(),
      total_fee: order.orderFare + order.fee + order.insurancePay,
      trade_type: 'pay.weixin.jspay',
      transaction_id: '8711410001201612317089540276',
      version: '2.0'
    }
  }

  // 模拟支付通知
  log('-----------------------');
  log('支付通知');
  var payStatus = yield notify(paySuccess, 1);
  log('支付结果：' + (payStatus ? '成功' : '失败'));
  if(!payStatus) {
    throw new CenterException('支付失败');
  }

  // 退票
  log('-----------------------');
  log('订单退票');

  log('申请退票');
  var refundApplyRes = yield axios.post(ORDER_REFUND_APPLY, {
    orderId: orderId
  });
  log(refundApplyRes.data);
  if(!refundApplyRes.data.success) {
    throw new CenterException('退票申请失败：' + refundApplyRes.data.retMessage);
  }

  log('退票申请成功：退票手续费' + refundApplyRes.data.result.ticket_refund_fee + ',退票有效期' + refundApplyRes.data.result.ticket_refund_expire);
  log('-----------------------');
  log('确认退票');
  var refundRes = yield axios.post(ORDER_REFUND, {
    orderId: orderId
  });
  log(refundRes.data);
  if(!refundRes.data.success) {
    throw new CenterException('退票申请失败：' + refundRes.data.retMessage);
  }
  log('退票成功：' + refundRes.data.retMessage);

}).then(function(err) {
}).catch(onError);

function notify(paySuccess, count) {
  log('通知次数：' + count);
  if(count >= 10) {
    return false;
    // throw new CenterException('支付通知超时');
  }
  return axios.post(WECHAT_NOTIFY, json2xml(paySuccess)
  , {
    'headers': {
      'Content-Type': 'application/xml'
    }
  }).then(function(res) {
    if(res.data == 'fail') {
      // 重复
      log('支付失败，重新通知');
      return notify(paySuccess, count+1);
    }
    return true;
  }).catch(function(err) {
    return false;
  });
}
