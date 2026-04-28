// =============================================================
// Excel 解析 & 日 K 聚合
// 输入：分时 Excel（第1列日期时间，2~5列 价格/分时成交量/分时成交额/涨跌幅）
// 输出：[{date, open, high, low, close, volume, amount, intraday_json}, ...]
// =============================================================
(function (global) {

  /**
   * 把 Excel 序列号转成 yyyy-mm-dd HH:MM:SS
   */
  function excelDateToISO(serial) {
    if (typeof serial === 'string') return serial;
    if (typeof serial !== 'number' || !isFinite(serial)) return null;
    var ms = Math.round((serial - 25569) * 86400 * 1000);
    var d = new Date(ms);
    return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  }

  /**
   * 解析时间到 {date:'YYYY-MM-DD', time:'HH:MM'} —— 只到分钟
   */
  function parseDateTime(v) {
    if (v == null || v === '') return null;
    var s;
    if (v instanceof Date) {
      s = v.getFullYear() + '-' +
          String(v.getMonth() + 1).padStart(2, '0') + '-' +
          String(v.getDate()).padStart(2, '0') + ' ' +
          String(v.getHours()).padStart(2, '0') + ':' +
          String(v.getMinutes()).padStart(2, '0');
    } else if (typeof v === 'number') {
      var iso = excelDateToISO(v);
      if (!iso) return null;
      s = iso;
    } else {
      s = String(v).trim();
    }
    // 期望格式: "2026-01-05 09:30:00" 或 "2026-01-05 09:30"
    var m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{1,2})/);
    if (!m) return null;
    var date = m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    var time = m[4].padStart(2, '0') + ':' + m[5].padStart(2, '0');
    return { date: date, time: time };
  }

  function toNum(v) {
    if (v == null || v === '') return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }

  /**
   * 主入口：传入 ArrayBuffer，返回聚合好的日 K 数组
   * @param {ArrayBuffer} ab
   * @return {{stockName:string|null, days:Array}}
   */
  function parseAndAggregate(ab) {
    if (!global.XLSX) throw new Error('XLSX 库未加载');
    var wb = global.XLSX.read(ab, { type: 'array', cellDates: true });
    var ws = wb.Sheets[wb.SheetNames[0]];
    // 转为二维数组（每行一个数组）；header:1 表示不要把第一行当列名
    var rows = global.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

    if (rows.length < 2) return { stockName: null, days: [] };

    // 第一行第一列通常是股票名，第二行通常是表头（"分时点 价格 分时成交量 分时成交额 涨跌幅"）
    // 也兼容直接是数据的情况
    var stockName = null;
    var startIdx = 0;
    var firstA = rows[0] ? rows[0][0] : null;
    if (firstA && typeof firstA === 'string' && !/^\d{4}/.test(firstA)) {
      stockName = String(firstA).trim();
      startIdx = 1;
    }
    // 若第二行也是表头（包含 "分时" 等中文），跳过
    var maybeHeader = rows[startIdx] || [];
    var headerStr = (maybeHeader[0] + '|' + maybeHeader[1]).toString();
    if (/分时|价格|date|time/i.test(headerStr)) {
      startIdx += 1;
    }

    // 按日期分组
    var groups = {};  // 'YYYY-MM-DD' -> Array<minute row>
    var orderedDates = [];

    for (var i = startIdx; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.length === 0) continue;
      var dt = parseDateTime(r[0]);
      if (!dt) continue;
      var price = toNum(r[1]);
      var volume = toNum(r[2]);
      var amount = toNum(r[3]);
      var change = toNum(r[4]);
      // 跳过整行无价格、无量、无额（停盘的"NaN"行）
      if (price == null && (volume == null || volume === 0) && (amount == null || amount === 0)) {
        continue;
      }
      if (!groups[dt.date]) {
        groups[dt.date] = [];
        orderedDates.push(dt.date);
      }
      groups[dt.date].push({
        t: dt.time,
        p: price,
        v: volume == null ? 0 : volume,
        a: amount == null ? 0 : amount,
        c: change == null ? null : Number(change.toFixed(6))
      });
    }

    orderedDates.sort();
    var days = [];

    for (var di = 0; di < orderedDates.length; di++) {
      var date = orderedDates[di];
      var ticks = groups[date];
      ticks.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });

      // 提取价格非空的 ticks 用于 OHLC
      var priceTicks = ticks.filter(function (x) { return x.p != null; });
      if (priceTicks.length === 0) continue;
      var open = priceTicks[0].p;
      var close = priceTicks[priceTicks.length - 1].p;
      var high = -Infinity, low = Infinity;
      for (var pi = 0; pi < priceTicks.length; pi++) {
        if (priceTicks[pi].p > high) high = priceTicks[pi].p;
        if (priceTicks[pi].p < low) low = priceTicks[pi].p;
      }
      var volumeSum = 0, amountSum = 0;
      for (var ti = 0; ti < ticks.length; ti++) {
        volumeSum += ticks[ti].v || 0;
        amountSum += ticks[ti].a || 0;
      }
      days.push({
        date: date,
        open: round(open, 4),
        high: round(high, 4),
        low: round(low, 4),
        close: round(close, 4),
        volume: Math.round(volumeSum),
        amount: Math.round(amountSum),
        intraday_json: JSON.stringify(ticks)
      });
    }

    return { stockName: stockName, days: days };
  }

  function round(v, n) {
    if (v == null) return null;
    var k = Math.pow(10, n || 0);
    return Math.round(v * k) / k;
  }

  global.YcctExcel = {
    parseAndAggregate: parseAndAggregate
  };
})(window);
