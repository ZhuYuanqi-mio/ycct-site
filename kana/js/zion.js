// =============================================================
// Zion webhook 调用封装
// 每个 action 在 Zion 创建后会有一个 callback URL
// 直接 POST JSON 即可，response.data 就是出参对象
// =============================================================
(function (global) {
  var CFG = global.YCCT_CONFIG || {};
  var TIMEOUT = CFG.timeout || 20000;
  var URLS = (CFG.zion || {});

  /**
   * 通用 webhook 调用
   * @param {string} url Zion callback URL
   * @param {object} body 入参对象
   * @return {Promise<object>} 出参对象
   */
  async function callWebhook(url, body, timeoutMs) {
    if (!url) throw new Error('Zion webhook URL 未配置（请编辑 config.js）');
    var ctrl = new AbortController();
    var to = timeoutMs || TIMEOUT;
    var t = setTimeout(function () { ctrl.abort(); }, to);
    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      // 把 abort 错误改写成更友好的提示
      if (err && err.name === 'AbortError') {
        throw new Error('请求超时（' + (to / 1000) + 's），网络或后端慢，请稍后重试或减少单批数据量');
      }
      throw err;
    } finally {
      clearTimeout(t);
    }
  }

  // ----- 业务封装 -----

  async function createStock(name, code) {
    var r = await callWebhook(URLS.createStock, {
      stock_json: JSON.stringify({ name: name, code: code })
    });
    return r.stock_id;
  }

  async function listStocks() {
    var r = await callWebhook(URLS.listStocks, {});
    var raw = r.stocks_data;
    if (!raw) return [];
    var arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  }

  async function deleteStock(stockId) {
    var r = await callWebhook(URLS.deleteStock, { stock_id: stockId });
    return r.result;
  }

  /**
   * 拉取某只股票的全部日 K（**不**含 intraday_json，列表轻量）
   * @param {number} stockId
   * @return {Promise<Array<object>>}
   */
  async function listKline(stockId) {
    // 数据量大时 Zion 可能首次冷启动较慢，给 60s 超时
    var r = await callWebhook(URLS.listKline, { stock_id: stockId }, 60000);
    var raw = r.kline_data;
    if (!raw) return [];
    var arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  }

  /**
   * 按需拉取某天的分时数据
   * @param {number} klineId
   * @return {Promise<Array<object>>} [{t,p,v,a,c}, ...]
   */
  async function getIntraday(klineId) {
    // 单天分时 ~17KB，但 Zion 偶尔冷启动慢，给 60s
    var r = await callWebhook(URLS.getIntraday, { kline_id: klineId }, 60000);
    var raw = r.intraday_json;
    if (!raw) return [];
    var arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  }

  /**
   * 保存某股的标注线 + 显示设置（覆盖式）
   * @param {number} stockId
   * @param {Array<string>} markerDates 日期数组 ['YYYY-MM-DD', ...]
   * @param {object} dpSettings  {dpPrice, dpAmount, dpVolume, volUnit, fontSize}
   * @return {Promise<string>}
   */
  async function saveMarkers(stockId, markerDates, dpSettings) {
    var r = await callWebhook(URLS.saveMarkers, {
      stock_id: stockId,
      markers_json: JSON.stringify(markerDates || []),
      dp_json: JSON.stringify(dpSettings || {})
    });
    return r.result;
  }

  /**
   * 读取某股的标注线 + 显示设置
   * @param {number} stockId
   * @return {Promise<{markers:Array<string>, dp:object}>}
   */
  async function getMarkers(stockId) {
    var r = await callWebhook(URLS.getMarkers, { stock_id: stockId });
    var raw = r.markers_data;
    if (!raw) return { markers: [], dp: {} };
    var data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      markers: Array.isArray(data.markers) ? data.markers : [],
      dp: data.dp || {}
    };
  }

  /**
   * 保存一条量/额累加计算
   * @param {number} stockId
   * @param {object} payload {calc_name, calc_type:'volume'|'amount', calc_value, source:[{date,col,value}]或[{date,time,col,value}], scope:'daily'|'intraday', intraday_kline_id?}
   * @return {Promise<number>} calc_id
   */
  async function saveCalc(stockId, payload) {
    var calc = {
      stock_id: stockId,
      calc_name: payload.calc_name || '未命名',
      calc_type: payload.calc_type || 'amount',
      calc_value: Number(payload.calc_value) || 0,
      source: payload.source || [],
      scope: payload.scope || 'daily',
      intraday_kline_id: payload.intraday_kline_id != null ? payload.intraday_kline_id : null
    };
    var r = await callWebhook(URLS.saveCalc, {
      calc_json: JSON.stringify(calc)
    });
    return r.calc_id;
  }

  /**
   * 拉取某股全部计算（日 K + 分时混在一起，前端按 scope/intraday_kline_id 过滤）
   * @param {number} stockId
   * @return {Promise<Array<object>>} [{id, calc_name, calc_type, calc_value, source, scope, intraday_kline_id, created_at}, ...]
   */
  async function listCalcs(stockId) {
    var r = await callWebhook(URLS.listCalcs, { stock_id: stockId });
    var raw = r.calcs_data;
    if (!raw) return [];
    var data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(data.calcs) ? data.calcs : [];
  }

  /**
   * 删除一条计算
   * @param {number} calcId
   * @return {Promise<string>}
   */
  async function deleteCalc(calcId) {
    var r = await callWebhook(URLS.deleteCalc, { calc_id: calcId });
    return r.result;
  }

  /**
   * 健康检查（尝试调一下 list_stocks，验证 webhook 可达）
   * @return {Promise<{ok:boolean, msg:string}>}
   */
  async function ping() {
    if (!URLS.listStocks) return { ok: false, msg: '未配置' };
    try {
      await callWebhook(URLS.listStocks, {});
      return { ok: true, msg: '已连接' };
    } catch (e) {
      return { ok: false, msg: '失败: ' + (e.message || e) };
    }
  }

  global.Zion = {
    createStock: createStock,
    listStocks: listStocks,
    deleteStock: deleteStock,
    listKline: listKline,
    getIntraday: getIntraday,
    saveMarkers: saveMarkers,
    getMarkers: getMarkers,
    saveCalc: saveCalc,
    listCalcs: listCalcs,
    deleteCalc: deleteCalc,
    ping: ping
  };
})(window);
