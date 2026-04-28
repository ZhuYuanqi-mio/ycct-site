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
  async function callWebhook(url, body) {
    if (!url) throw new Error('Zion webhook URL 未配置（请编辑 config.js）');
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, TIMEOUT);
    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
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
   * 批量导入日 K（带 intraday_json）
   * @param {number} stockId
   * @param {Array<object>} klineRows  [{date, open, high, low, close, volume, amount, intraday_json}]
   * @return {Promise<{inserted:number, updated:number}>}
   */
  async function importKline(stockId, klineRows) {
    var r = await callWebhook(URLS.importKline, {
      stock_id: stockId,
      kline_json: JSON.stringify(klineRows)
    });
    return {
      inserted: parseInt(r.inserted || 0),
      updated: parseInt(r.updated || 0)
    };
  }

  /**
   * 拉取某只股票的全部日 K（**不**含 intraday_json，列表轻量）
   * @param {number} stockId
   * @return {Promise<Array<object>>}
   */
  async function listKline(stockId) {
    var r = await callWebhook(URLS.listKline, { stock_id: stockId });
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
    var r = await callWebhook(URLS.getIntraday, { kline_id: klineId });
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
    importKline: importKline,
    listKline: listKline,
    getIntraday: getIntraday,
    saveMarkers: saveMarkers,
    getMarkers: getMarkers,
    ping: ping
  };
})(window);
