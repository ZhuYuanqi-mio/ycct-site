// =============================================================
// YCCT 主应用逻辑
// =============================================================
(function () {

  // ============== State ==============
  var state = {
    stocks: [],          // [{id, name, code, created_at}]
    activeStockId: null,
    klineData: null,     // {name, code, dates[], open[], high[], low[], close[], volume[], amount[]}
    markers: [],         // index 数组
    chart: null,         // YcctChart instance
    saved: {},           // localStorage 缓存（仅演示模式用）：{stockId: {markers:[YYYY-MM-DD,...], dp:{...}}}
    isDemo: false,       // 演示模式标志

    // 双击行为：true=打/取消标注；false=弹出当天分时图
    annotationMode: true,

    // 分时图浮窗
    intraday: {
      open: false,
      dayIdx: -1,        // 在 klineData.dates 中的索引
      ticks: [],         // [{t,p,v,a,c}]
      markers: [],       // tick 的索引数组（仅本次会话内存）
      chart: null
    },
    // 缓存：klineId -> ticks，避免反复请求
    intradayCache: {},

    // 视窗偏好
    defaultViewSize: 20,             // 默认显示最近 20 个交易日
    viewByStock: {},                 // {stockId: {start, end}} 每只股票各自记忆

    // 量/额累加计算
    calc: {
      mode: false,                   // 计算开关
      // 日 K 草稿：按类型分别保存。每条 = {type, cells:[{date,col,value}]}
      dailyDraft: { volume: null, amount: null },
      // 分时草稿：同样按类型分。kline_id 共享在 bag 上
      intradayDraft: { volume: null, amount: null, kline_id: null, date: null },
      // 已保存（来自 Zion）
      daily: [],
      intraday: [],
      // 草稿浮框：scope + anchorRect + pendingType（保存 modal 时记当前在保存哪个 type）
      float: { scope: null, anchorRect: null, pendingType: null }
    }
  };

  var els = {};

  // ============== Toast ==============
  function toast(msg, ms) {
    var t = els.toast;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      t.classList.remove('show');
    }, ms || 1800);
  }

  // ============== 本地缓存 ==============
  function loadLocal() {
    try {
      state.saved = JSON.parse(localStorage.getItem('ycct_v1') || '{}');
    } catch (e) { state.saved = {}; }
  }
  function saveLocal() {
    try { localStorage.setItem('ycct_v1', JSON.stringify(state.saved)); } catch (e) {}
  }
  function getSaved(stockId) {
    return state.saved[stockId] || { markers: [], dp: null };
  }
  function setSaved(stockId, patch) {
    var cur = getSaved(stockId);
    Object.assign(cur, patch);
    state.saved[stockId] = cur;
    saveLocal();
  }

  // ============== Sidebar 渲染 ==============
  function renderStockList() {
    var list = els.stockList;
    if (state.stocks.length === 0) {
      list.innerHTML = '<div class="empty-tip">还没有股票<br>点击右上角 <b>新建</b> 开始</div>';
      renderMobileStockMenu();
      return;
    }
    var html = '';
    for (var i = 0; i < state.stocks.length; i++) {
      var s = state.stocks[i];
      var active = s.id === state.activeStockId ? ' active' : '';
      var ts = s.created_at ? formatTime(s.created_at) : '';
      html += '<div class="stock-item' + active + '" data-id="' + s.id + '">' +
        '<div class="stock-name">' + escapeHtml(s.name) + '</div>' +
        '<div class="stock-code">' + escapeHtml(s.code) + '</div>' +
        '<div class="stock-meta">加入时间 ' + ts + '</div>' +
        '<span class="stock-del" title="删除股票"><svg class="ico"><use href="#icon-trash"/></svg></span>' +
        '</div>';
    }
    list.innerHTML = html;
    renderMobileStockMenu();
    // 绑定点击
    var items = list.querySelectorAll('.stock-item');
    items.forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.classList.contains('stock-del')) return;
        var id = +el.dataset.id;
        switchStock(id);
      });
      var del = el.querySelector('.stock-del');
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = +el.dataset.id;
        var s = state.stocks.find(function (x) { return x.id === id; });
        if (!s) return;
        if (!confirm('确定删除股票 [' + s.name + ' (' + s.code + ')] 及其全部 K 线数据吗？')) return;
        Zion.deleteStock(id).then(function () {
          toast('已删除');
          delete state.saved[id];
          saveLocal();
          if (state.activeStockId === id) {
            state.activeStockId = null;
            state.klineData = null;
            state.markers = [];
            renderChart();
          }
          loadStocks();
        }).catch(function (e) {
          toast('删除失败: ' + e.message);
        });
      });
    });
  }

  // ============== 顶部「切换股票」下拉（手机端可见） ==============
  function renderMobileStockMenu() {
    if (!els.mobileStockMenu) return;
    // 顶部按钮文案
    var current = null;
    for (var k = 0; k < state.stocks.length; k++) {
      if (state.stocks[k].id === state.activeStockId) { current = state.stocks[k]; break; }
    }
    if (els.mobileStockName) {
      els.mobileStockName.textContent = current
        ? current.name + ' (' + current.code + ')'
        : '选择股票';
    }
    // 下拉项
    if (state.stocks.length === 0) {
      els.mobileStockMenu.innerHTML = '<div class="menu-empty">还没有股票</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < state.stocks.length; i++) {
      var s = state.stocks[i];
      var active = s.id === state.activeStockId ? ' active' : '';
      html += '<div class="menu-item' + active + '" data-id="' + s.id + '">' +
        '<span class="menu-name">' + escapeHtml(s.name) + '</span>' +
        '<span class="menu-code">' + escapeHtml(s.code) + '</span>' +
        '</div>';
    }
    els.mobileStockMenu.innerHTML = html;
  }

  function toggleMobileStockMenu(force) {
    if (!els.mobileStockMenu) return;
    var willShow = (typeof force === 'boolean') ? force : els.mobileStockMenu.hasAttribute('hidden');
    if (willShow) els.mobileStockMenu.removeAttribute('hidden');
    else els.mobileStockMenu.setAttribute('hidden', '');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatTime(ts) {
    if (!ts) return '';
    try {
      var d = new Date(ts);
      if (!isFinite(d)) return ts;
      return d.getFullYear() + '/' +
        String(d.getMonth() + 1).padStart(2, '0') + '/' +
        String(d.getDate()).padStart(2, '0') + ' ' +
        String(d.getHours()).padStart(2, '0') + ':' +
        String(d.getMinutes()).padStart(2, '0');
    } catch (e) { return ts; }
  }

  // ============== Zion 数据加载 ==============
  function loadStocks() {
    return Zion.listStocks().then(function (list) {
      state.stocks = (list || []).slice().sort(function (a, b) {
        return (a.created_at || '') < (b.created_at || '') ? 1 : -1;
      });
      renderStockList();
    }).catch(function (e) {
      toast('加载股票列表失败: ' + e.message);
      console.error(e);
    });
  }

  function switchStock(id) {
    if (state.activeStockId === id) return;
    state.activeStockId = id;
    state.markers = [];
    state.klineData = null;
    state.intradayCache = {};
    clearCalcs();
    if (state.intraday.open) closeIntraday();
    renderStockList();
    showLoading('正在加载 K 线数据...');
    // 同时拉 K 线、标注、计算记录（并行）
    Promise.all([
      Zion.listKline(id),
      state.isDemo ? Promise.resolve(getSaved(id)) : Zion.getMarkers(id).catch(function (e) {
        console.warn('读取标注失败，忽略:', e.message);
        return { markers: [], dp: {} };
      }),
      state.isDemo ? Promise.resolve([]) : Zion.listCalcs(id).catch(function (e) {
        console.warn('读取计算记录失败，忽略:', e.message);
        return [];
      })
    ]).then(function (results) {
      hideLoading();
      var rows = results[0];
      var saved = results[1];
      var calcs = results[2] || [];

      // 分组到 daily / intraday
      state.calc.daily = calcs.filter(function (c) { return c.scope === 'daily'; });
      state.calc.intraday = calcs.filter(function (c) { return c.scope === 'intraday'; });
      renderCalcTables();

      if (!rows || rows.length === 0) {
        state.klineData = null;
        renderChart();
        showStatus('该股票暂无 K 线数据，请在 Zion 后台向 ycct_kline 表批量上传 CSV');
        return;
      }
      // 排序：按 date 升序
      rows.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var stock = state.stocks.find(function (x) { return x.id === id; });
      var closes = rows.map(function (r) { return +r.close; });
      state.klineData = {
        name: stock ? stock.name : '',
        code: stock ? stock.code : '',
        dates: rows.map(function (r) { return r.date; }),
        open: rows.map(function (r) { return +r.open; }),
        high: rows.map(function (r) { return +r.high; }),
        low: rows.map(function (r) { return +r.low; }),
        close: closes,
        volume: rows.map(function (r) { return r.volume == null ? null : +r.volume; }),
        amount: rows.map(function (r) { return r.amount == null ? null : +r.amount; }),
        change: YcctChartUtils.computeChangePct(closes),
        klineIds: rows.map(function (r) { return r.id; })
      };
      // 恢复保存的 markers 与 dp 设置
      if (saved && saved.markers && saved.markers.length > 0) {
        state.markers = saved.markers
          .map(function (d) { return state.klineData.dates.indexOf(d); })
          .filter(function (i) { return i >= 0; });
        state.markers.sort(function (a, b) { return a - b; });
      }
      if (saved && saved.dp && Object.keys(saved.dp).length > 0) {
        applyDp(saved.dp);
      }
      renderChart();
      renderMarkerTags();
      showStatus('已加载 ' + rows.length + ' 个交易日' +
        (state.markers.length > 0 ? '，恢复 ' + state.markers.length + ' 条已保存标注' : ''));
    }).catch(function (e) {
      hideLoading();
      toast('加载失败: ' + e.message);
      console.error(e);
    });
  }

  // ============== 图表渲染 ==============
  function renderChart() {
    var wrap = els.chartWrap;
    if (!state.klineData) {
      wrap.innerHTML = '<div class="empty-chart">' +
        (state.activeStockId == null ?
          '请在左侧选择一只股票<br><span style="font-size:12px;color:var(--text-4)">没有股票？点击左上角「新建」</span>' :
          '该股票还没有 K 线数据<br><span style="font-size:12px;color:var(--text-4)">请在 Zion 后台向 <code>ycct_kline</code> 表上传 CSV</span>') +
        '</div>';
      els.intervalSec.style.display = 'none';
      return;
    }
    wrap.innerHTML =
      '<canvas id="cv"></canvas>' +
      '<div class="chart-hint">' +
        '<span id="viewInfo"></span>' +
        '<span class="dim-sep">·</span>' +
        '双击插入标注 · 右键删除最近的标注' +
      '</div>' +
      '<div class="pager">' +
        '<button class="pager-btn" id="btnPanLeft" title="向左平移 5 天（看更早）">' +
          '<svg class="ico"><use href="#icon-arrow-left"/></svg>5 天' +
        '</button>' +
        '<button class="pager-btn" id="btnPanLeft1" title="向左 1 天">' +
          '<svg class="ico"><use href="#icon-arrow-left"/></svg>1 天' +
        '</button>' +
        '<span class="pager-info" id="pagerInfo"></span>' +
        '<button class="pager-btn" id="btnPanRight1" title="向右 1 天">' +
          '1 天<svg class="ico"><use href="#icon-arrow-right"/></svg>' +
        '</button>' +
        '<button class="pager-btn" id="btnPanRight" title="向右平移 5 天（看更晚）">' +
          '5 天<svg class="ico"><use href="#icon-arrow-right"/></svg>' +
        '</button>' +
      '</div>';
    var canvas = document.getElementById('cv');
    var dpOpts = readDp();
    // 初始视窗：每只股票分别记忆，否则默认显示最近 20 天
    var initOpts = { initialViewSize: state.defaultViewSize };
    var saved = state.viewByStock[state.activeStockId];
    if (saved && saved.start != null && saved.end != null) {
      initOpts.initialViewStart = saved.start;
      initOpts.initialViewEnd = saved.end;
    }
    state.chart = new YcctChart(canvas, Object.assign({
      data: state.klineData,
      markers: state.markers,
      showAverages: els.showAvg.checked,
      dpPrice: dpOpts.dpPrice,
      dpAmount: dpOpts.dpAmount,
      dpVolume: dpOpts.dpVolume,
      volUnit: dpOpts.volUnit,
      fontSize: dpOpts.fontSize,
      onDblclick: onDayChartDblclick,
      onCellDblclick: onDailyCellDblclick,
      onCellRangeSelect: onDailyCellRangeSelect,
      calcModeEnabled: state.calc.mode,
      calcDraftKeys: getDailyDraftKeys(),
      calcSavedKeys: getDailySavedKeys(),
      onView: updateViewInfo
    }, initOpts));
    state.chart.draw();
    updateViewInfo(state.chart.getViewInfo());
    bindPagerHandlers();
    renderIntervalTable();
    renderMarkerGrid();
  }

  function bindPagerHandlers() {
    var bL5 = document.getElementById('btnPanLeft');
    var bL1 = document.getElementById('btnPanLeft1');
    var bR1 = document.getElementById('btnPanRight1');
    var bR5 = document.getElementById('btnPanRight');
    if (bL5) bL5.addEventListener('click', function () { state.chart && state.chart.panBy(-5); });
    if (bL1) bL1.addEventListener('click', function () { state.chart && state.chart.panBy(-1); });
    if (bR1) bR1.addEventListener('click', function () { state.chart && state.chart.panBy(1); });
    if (bR5) bR5.addEventListener('click', function () { state.chart && state.chart.panBy(5); });
  }

  function updateViewInfo(info) {
    if (!info) return;
    var elH = document.getElementById('viewInfo');
    var visN = info.end - info.start + 1;
    var rangeText = (info.startDate || '').slice(5) + ' ~ ' + (info.endDate || '').slice(5);
    if (elH) elH.textContent = '显示 ' + rangeText + '（' + visN + ' / ' + info.total + ' 天）';

    // 分页栏中段
    var pi = document.getElementById('pagerInfo');
    if (pi) pi.innerHTML = '<b>' + rangeText + '</b> · ' + visN + ' / ' + info.total + ' 天';

    // 边界禁用按钮
    var bL5 = document.getElementById('btnPanLeft');
    var bL1 = document.getElementById('btnPanLeft1');
    var bR1 = document.getElementById('btnPanRight1');
    var bR5 = document.getElementById('btnPanRight');
    if (bL5) bL5.disabled = info.start === 0;
    if (bL1) bL1.disabled = info.start === 0;
    if (bR1) bR1.disabled = info.end === info.total - 1;
    if (bR5) bR5.disabled = info.end === info.total - 1;

    // 工具栏天数输入框：仅在用户没在编辑时同步
    if (els.viewSizeInput && document.activeElement !== els.viewSizeInput) {
      els.viewSizeInput.value = visN;
    }
    if (els.viewSizeInput) els.viewSizeInput.max = String(info.total);

    // 起止日期输入框：同步 + 设 min/max 范围
    if (state.klineData && els.viewDateStart && els.viewDateEnd) {
      var dates = state.klineData.dates;
      var minD = dates[0];
      var maxD = dates[dates.length - 1];
      els.viewDateStart.min = minD; els.viewDateStart.max = maxD;
      els.viewDateEnd.min = minD;   els.viewDateEnd.max = maxD;
      if (document.activeElement !== els.viewDateStart) els.viewDateStart.value = info.startDate || '';
      if (document.activeElement !== els.viewDateEnd)   els.viewDateEnd.value   = info.endDate   || '';
    }

    // 同步 +/- 按钮可用性
    if (els.btnZoomIn) els.btnZoomIn.disabled = visN <= 8;
    if (els.btnZoomOut) els.btnZoomOut.disabled = visN >= info.total;

    // 缓存当前股票的视窗偏好（按股票分别记忆）
    if (state.activeStockId != null) {
      state.viewByStock[state.activeStockId] = { start: info.start, end: info.end };
    }

    // 手机端标注网格也要随视窗刷新
    renderMarkerGrid();
  }

  function onDayChartDblclick(idx) {
    if (state.annotationMode) {
      toggleMarker(idx);
    } else {
      openIntraday(idx);
    }
  }

  function toggleMarker(idx) {
    var i = state.markers.indexOf(idx);
    if (i >= 0) state.markers.splice(i, 1);
    else { state.markers.push(idx); state.markers.sort(function (a, b) { return a - b; }); }
    state.chart.update({ markers: state.markers });
    renderMarkerTags();
    renderIntervalTable();
    renderMarkerGrid();
  }

  // ============== 分时图浮窗 ==============
  function openIntraday(dayIdx) {
    if (!state.klineData) return;
    var dates = state.klineData.dates;
    if (dayIdx < 0 || dayIdx >= dates.length) return;

    state.intraday.open = true;
    state.intraday.dayIdx = dayIdx;
    state.intraday.markers = [];
    state.intraday.ticks = [];

    // 立即销毁上一次的实例 + 清空 canvas，避免在 loading 期间鼠标 hover 时旧实例继续 redraw 出旧数据
    if (state.intraday.chart && state.intraday.chart.destroy) {
      state.intraday.chart.destroy();
      state.intraday.chart = null;
    }

    // 头部信息
    els.ipSymbol.textContent = (state.klineData.name || '') +
      ' (' + (state.klineData.code || '') + ')';
    els.ipDate.textContent = dates[dayIdx];
    var change = state.klineData.change ? state.klineData.change[dayIdx] : null;
    if (change != null && isFinite(change)) {
      var s = change >= 0 ? '+' : '';
      els.ipChange.textContent = s + change.toFixed(2) + '%';
      els.ipChange.style.color = change >= 0 ? '#ef4444' : (change < 0 ? '#22c55e' : '#6b7280');
    } else {
      els.ipChange.textContent = '';
    }
    els.ipMeta.textContent =
      '开 ' + state.klineData.open[dayIdx].toFixed(2) +
      ' / 收 ' + state.klineData.close[dayIdx].toFixed(2);

    els.intradayPop.classList.add('show');
    els.ipEmpty.style.display = 'none';
    els.ipCanvas.style.display = '';
    showIpLoading();

    var stockId = state.activeStockId;
    var klineId = state.klineData.klineIds ? state.klineData.klineIds[dayIdx] : null;
    var cacheKey = state.isDemo ? ('demo_' + stockId + '_' + dayIdx)
                                : (klineId != null ? ('k_' + klineId) : null);

    var fetchPromise;
    if (cacheKey && state.intradayCache[cacheKey]) {
      fetchPromise = Promise.resolve(state.intradayCache[cacheKey]);
    } else if (state.isDemo) {
      // 演示模式：从 _demo_kline.json 的 rows[dayIdx].intraday_json 取
      fetchPromise = fetchDemoIntraday(dayIdx);
    } else if (klineId != null) {
      fetchPromise = Zion.getIntraday(klineId);
    } else {
      fetchPromise = Promise.reject(new Error('未取到 kline_id'));
    }

    fetchPromise.then(function (ticks) {
      hideIpLoading();
      if (cacheKey) state.intradayCache[cacheKey] = ticks;
      if (!ticks || ticks.length === 0) {
        showIpEmpty('该交易日没有分时数据' +
          (state.isDemo ? '（演示数据未包含）' : '（导入时未保存或为空）'));
        return;
      }
      state.intraday.ticks = ticks;
      renderIntradayChart();
    }).catch(function (err) {
      hideIpLoading();
      showIpEmpty('加载分时失败：' + (err.message || err));
    });
  }

  function fetchDemoIntraday(dayIdx) {
    return fetch('_demo_kline.json').then(function (r) { return r.json(); }).then(function (d) {
      var row = d.rows && d.rows[dayIdx];
      if (!row || !row.intraday_json) return [];
      try {
        var arr = typeof row.intraday_json === 'string' ?
          JSON.parse(row.intraday_json) : row.intraday_json;
        return Array.isArray(arr) ? arr : [];
      } catch (e) { return []; }
    });
  }

  function closeIntraday() {
    state.intraday.open = false;
    els.intradayPop.classList.remove('show');
    if (state.intraday.chart && state.intraday.chart.destroy) {
      state.intraday.chart.destroy();
    }
    state.intraday.chart = null;
    // 关闭浮窗时也丢弃未保存的分时草稿（避免下次打开同一天看到一份残留草稿但失去当时上下文）
    var bag = state.calc.intradayDraft;
    if (bag && (bag.volume || bag.amount)) {
      bag.volume = null; bag.amount = null; bag.kline_id = null; bag.date = null;
      refreshIntradayChartCalcKeys();
      renderCalcTables();
    }
    if (state.calc.float.scope === 'intraday') hideCalcFloat();
  }

  // ---------- 分时浮窗 header 拖拽 ----------
  function bindIntradayDrag() {
    var dragging = false;
    var startX = 0, startY = 0;
    var origLeft = 0, origTop = 0;
    var pop = els.intradayPop;
    var header = pop.querySelector('.ip-header');

    header.addEventListener('mousedown', function (e) {
      // 关闭按钮区域不触发拖拽
      if (e.target.closest('.ip-close')) return;
      if (e.button !== 0) return;
      dragging = true;
      header.classList.add('dragging');
      startX = e.clientX;
      startY = e.clientY;
      var rect = pop.getBoundingClientRect();
      origLeft = rect.left;
      origTop = rect.top;
      // 第一次拖动时切到绝对定位（脱离 right/bottom）
      if (!pop.classList.contains('dragged')) {
        pop.style.left = origLeft + 'px';
        pop.style.top = origTop + 'px';
        pop.classList.add('dragged');
      }
      e.preventDefault();
    });

    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      var w = pop.offsetWidth;
      var h = pop.offsetHeight;
      var nx = origLeft + dx;
      var ny = origTop + dy;
      // 限定在可视范围内（留 8px 余量）
      var maxX = window.innerWidth - w - 8;
      var maxY = window.innerHeight - h - 8;
      if (nx < 8) nx = 8;
      if (nx > maxX) nx = maxX;
      if (ny < 8) ny = 8;
      if (ny > maxY) ny = maxY;
      pop.style.left = nx + 'px';
      pop.style.top = ny + 'px';
    });

    document.addEventListener('mouseup', function () {
      if (dragging) {
        dragging = false;
        header.classList.remove('dragging');
      }
    });
  }

  function showIpLoading() { els.ipLoading.classList.add('show'); }
  function hideIpLoading() { els.ipLoading.classList.remove('show'); }
  function showIpEmpty(msg) {
    els.ipEmpty.textContent = msg;
    els.ipEmpty.style.display = 'flex';
    els.ipCanvas.style.display = 'none';
  }

  function renderIntradayChart() {
    // 销毁旧实例：避免上一次打开的 IntradayChart 残留事件继续在同一 canvas 上 redraw
    if (state.intraday.chart && state.intraday.chart.destroy) {
      state.intraday.chart.destroy();
      state.intraday.chart = null;
    }

    var dayIdx = state.intraday.dayIdx;
    // 昨收：取上一日的 close（首日则用今日开盘价兜底）
    var prevClose = null;
    if (dayIdx > 0) prevClose = state.klineData.close[dayIdx - 1];
    if (prevClose == null) prevClose = state.klineData.open[dayIdx];

    state.intraday.chart = new YcctIntradayChart(els.ipCanvas, {
      ticks: state.intraday.ticks,
      prevClose: prevClose,
      markers: state.intraday.markers,
      onMark: toggleIntradayMarker,
      onCellDblclick: onIntradayCellDblclick,
      onCellRangeSelect: onIntradayCellRangeSelect,
      calcModeEnabled: state.calc.mode,
      calcDraftKeys: getIntradayDraftKeys(),
      calcSavedKeys: getIntradaySavedKeys()
    });
    state.intraday.chart.draw();
  }

  function toggleIntradayMarker(idx) {
    var arr = state.intraday.markers;
    var i = arr.indexOf(idx);
    if (i >= 0) arr.splice(i, 1);
    else { arr.push(idx); arr.sort(function (a, b) { return a - b; }); }
    if (state.intraday.chart) state.intraday.chart.update({ markers: arr });
  }

  function renderMarkerTags() {
    var c = els.markerTags;
    if (!c) return; // 标注 chip 区域已被移除（双击/右键已能管理标注）
    if (!state.klineData || state.markers.length === 0) {
      c.innerHTML = '';
      return;
    }
    var html = '';
    for (var i = 0; i < state.markers.length; i++) {
      var idx = state.markers[i];
      var d = state.klineData.dates[idx];
      html += '<span class="marker-tag">' + d.slice(5) +
        ' <span class="marker-x" data-i="' + i + '">×</span></span>';
    }
    c.innerHTML = html;
    c.querySelectorAll('.marker-x').forEach(function (el) {
      el.addEventListener('click', function () {
        var i = +el.dataset.i;
        state.markers.splice(i, 1);
        state.chart.update({ markers: state.markers });
        renderMarkerTags();
        renderIntervalTable();
        renderMarkerGrid();
      });
    });
  }

  // 手机端标注网格：4 列网格（日期/价格/成交额），按时间从左到右、从上到下
  function renderMarkerGrid() {
    if (!els.markerGrid) return;
    if (!state.klineData || !state.markers || state.markers.length === 0) {
      els.markerGrid.innerHTML = '';
      return;
    }
    var data = state.klineData;
    var dp = readDp();
    // 优先取视窗内的；如果 chart 还没就绪，则全部
    var info = state.chart ? state.chart.getViewInfo() : null;
    var idxs = state.markers.slice().sort(function (a, b) { return a - b; });
    if (info) {
      idxs = idxs.filter(function (i) { return i >= info.start && i <= info.end; });
    }
    if (idxs.length === 0) { els.markerGrid.innerHTML = ''; return; }

    var COLS = 4;
    var html = '';
    for (var g = 0; g < idxs.length; g += COLS) {
      var grp = idxs.slice(g, g + COLS);
      html += '<div class="mg-group">';
      // 日期行（mmDD）
      html += '<div class="mg-row mg-row-date">';
      for (var i = 0; i < grp.length; i++) {
        var d = data.dates[grp[i]] || '';
        html += '<span class="mg-cell">' + escapeHtml(d.slice(5).replace('-', '')) + '</span>';
      }
      // 占位补满 4 列（保持网格对齐）
      for (var p = grp.length; p < COLS; p++) html += '<span class="mg-cell"></span>';
      html += '</div>';
      // 价格行
      html += '<div class="mg-row mg-row-price">';
      for (i = 0; i < grp.length; i++) {
        var pr = data.close[grp[i]];
        html += '<span class="mg-cell">' + (pr == null ? '-' : Number(pr).toFixed(dp.dpPrice)) + '</span>';
      }
      for (p = grp.length; p < COLS; p++) html += '<span class="mg-cell"></span>';
      html += '</div>';
      // 成交额行（按 volUnit 换算）
      html += '<div class="mg-row mg-row-amount">';
      for (i = 0; i < grp.length; i++) {
        var a = data.amount && data.amount[grp[i]];
        html += '<span class="mg-cell">' + (a == null ? '-' : (a / dp.volUnit).toFixed(dp.dpAmount)) + '</span>';
      }
      for (p = grp.length; p < COLS; p++) html += '<span class="mg-cell"></span>';
      html += '</div>';
      html += '</div>';
    }
    els.markerGrid.innerHTML = html;
  }

  function renderIntervalTable() {
    var sec = els.intervalSec;
    if (!state.klineData || state.markers.length < 2) {
      sec.style.display = 'none';
      return;
    }
    var info = YcctChartUtils.computeIntervals(state.klineData, state.markers);
    if (!info || !info.intervals.length) {
      sec.style.display = 'none';
      return;
    }
    var dpP = +els.dpPrice.value;
    var html = '<div class="panel-title">' + escapeHtml(state.klineData.name) +
      ' (' + escapeHtml(state.klineData.code) + ') 区间数据' +
      ' <span class="dim">首日开盘价: ' + info.firstOpen.toFixed(dpP || 2) + '</span></div>';
    html += '<div style="overflow-x:auto"><table class="iv-table" id="ivT">';
    html += '<tr><th>区间</th><th>趋势</th><th>起始日期</th><th>起始价格</th>' +
      '<th>vs首日开盘价</th><th>结束日期</th><th>结束价格</th>' +
      '<th>vs首日开盘价</th><th>vs起始价格</th><th>区间天数</th></tr>';
    info.intervals.forEach(function (iv, idx) {
      var tc = iv.trend === '上涨' ? '#D04040' : '#2E7D32';
      var pc = iv.endVsStart > 0 ? '#D04040' : '#2E7D32';
      var ps = iv.endVsStart > 0 ? '+' : '';
      html += '<tr><td>' + (idx + 1) + '</td>' +
        '<td style="color:' + tc + ';font-weight:600">' + iv.trend + '</td>' +
        '<td>' + iv.startDate + '</td>' +
        '<td>' + iv.startPrice.toFixed(2) + '</td>' +
        '<td>' + iv.startVsFirst.toFixed(2) + '%</td>' +
        '<td>' + iv.endDate + '</td>' +
        '<td>' + iv.endPrice.toFixed(2) + '</td>' +
        '<td>' + iv.endVsFirst.toFixed(2) + '%</td>' +
        '<td style="color:' + pc + ';font-weight:600">' + ps + iv.endVsStart.toFixed(2) + '%</td>' +
        '<td>' + iv.days + '</td></tr>';
    });
    html += '</table></div>';
    html += '<button class="btn" style="margin-top:10px" id="btnCopyTable">' +
      '<svg class="ico"><use href="#icon-copy"/></svg>复制到剪贴板</button>';
    sec.innerHTML = html;
    sec.style.display = 'block';
    document.getElementById('btnCopyTable').addEventListener('click', copyTable);
  }

  function copyTable() {
    var t = document.getElementById('ivT');
    if (!t) return;
    var s = '';
    for (var i = 0; i < t.rows.length; i++) {
      var cells = t.rows[i].cells;
      for (var j = 0; j < cells.length; j++) {
        s += cells[j].textContent + (j < cells.length - 1 ? '\t' : '');
      }
      s += '\n';
    }
    navigator.clipboard.writeText(s).then(function () {
      toast('已复制，可粘贴到 Excel');
    });
  }

  // ============== Toolbar handlers ==============
  function readDp() {
    return {
      dpPrice: +els.dpPrice.value || 0,
      dpAmount: +els.dpAmount.value || 0,
      dpVolume: +els.dpVolume.value || 0,
      volUnit: +els.volUnit.value || 100000000,
      fontSize: +els.fontSize.value || 12,
      showAvg: !!els.showAvg.checked
    };
  }

  function applyDp(dp) {
    if (!dp) return;
    if (dp.dpPrice != null) els.dpPrice.value = dp.dpPrice;
    if (dp.dpAmount != null) els.dpAmount.value = dp.dpAmount;
    if (dp.dpVolume != null) els.dpVolume.value = dp.dpVolume;
    if (dp.volUnit != null) els.volUnit.value = dp.volUnit;
    if (dp.fontSize != null) {
      els.fontSize.value = dp.fontSize;
      els.fsVal.textContent = dp.fontSize + 'px';
    }
    if (dp.showAvg != null) els.showAvg.checked = !!dp.showAvg;
  }

  function adjFs(d) {
    var v = Math.max(2, Math.min(12, +els.fontSize.value + d));
    els.fontSize.value = v;
    els.fsVal.textContent = v + 'px';
    if (state.chart) state.chart.update({ fontSize: v });
  }

  function refreshChartOnly() {
    if (state.chart) {
      state.chart.update(readDp());
      state.chart.update({ showAverages: els.showAvg.checked });
    }
    renderMarkerGrid();
  }

  function clearMarkers() {
    state.markers = [];
    if (state.chart) state.chart.update({ markers: [] });
    renderMarkerTags();
    renderIntervalTable();
    renderMarkerGrid();
  }

  function selectAllMarkers() {
    if (!state.klineData) return;
    state.markers = state.klineData.dates.map(function (_, i) { return i; });
    if (state.chart) state.chart.update({ markers: state.markers });
    renderMarkerTags();
    renderIntervalTable();
    renderMarkerGrid();
  }

  function saveMarkers() {
    if (!state.activeStockId) return toast('请先选择股票');
    if (!state.klineData) return toast('请先加载 K 线数据');
    var dates = state.markers.map(function (i) { return state.klineData.dates[i]; });
    var dp = readDp();

    // 演示模式只存 localStorage
    if (state.isDemo) {
      setSaved(state.activeStockId, { markers: dates, dp: dp });
      toast('已保存 ' + dates.length + ' 条标注（演示模式仅本地）');
      return;
    }

    // 真实模式：写入 Zion
    els.btnSave.disabled = true;
    Zion.saveMarkers(state.activeStockId, dates, dp).then(function () {
      // 同时也缓存到 localStorage 作为备份
      setSaved(state.activeStockId, { markers: dates, dp: dp });
      toast('已保存：' + dates.length + ' 条标注 + 显示设置');
    }).catch(function (e) {
      toast('保存失败: ' + e.message);
      console.error(e);
    }).finally(function () {
      els.btnSave.disabled = false;
    });
  }

  // ==================================================================
  // ============== 量/额累加计算（Calc panel）=========================
  // ==================================================================

  function clearCalcs() {
    state.calc.dailyDraft = { volume: null, amount: null };
    state.calc.intradayDraft = { volume: null, amount: null, kline_id: null, date: null };
    state.calc.daily = [];
    state.calc.intraday = [];
    hideCalcFloat();
    renderCalcTables();
  }

  function getCurrentKlineId() {
    if (!state.intraday.open) return null;
    var dayIdx = state.intraday.dayIdx;
    if (dayIdx < 0 || !state.klineData || !state.klineData.klineIds) return null;
    return state.klineData.klineIds[dayIdx] || null;
  }

  // ----- 日 K：双击量/额格子 -----
  function onDailyCellDblclick(hit) {
    if (!state.calc.mode) {
      toast('请先打开「计算」开关');
      return;
    }
    addToDailyDraft(hit);
    showCalcFloat('daily', hit.screen);
  }

  // 框选拖动结束：批量加入对应类型的草稿
  function onDailyCellRangeSelect(hits, anchorRect) {
    if (!state.calc.mode) return toast('请先打开「计算」开关');
    if (!hits || hits.length === 0) return;
    for (var i = 0; i < hits.length; i++) addToDailyDraft(hits[i], true);
    refreshDailyChartCalcKeys();
    showCalcFloat('daily', anchorRect);
    renderCalcTables();
  }

  // hit.col = 'volume' / 'amount'。同 type 的 cell 累加；不同 type 自动并行
  // _silent: 批量调用时不每次刷新
  function addToDailyDraft(hit, _silent) {
    var type = hit.col;
    var bag = state.calc.dailyDraft;
    var d = bag[type];
    if (!d) d = bag[type] = { type: type, cells: [] };
    var existIdx = -1;
    for (var i = 0; i < d.cells.length; i++) {
      if (d.cells[i].date === hit.date && d.cells[i].col === type) { existIdx = i; break; }
    }
    if (existIdx >= 0) {
      // 框选时不希望取消已有；只在单击时切换
      if (!_silent) {
        d.cells.splice(existIdx, 1);
        if (d.cells.length === 0) bag[type] = null;
      }
    } else {
      d.cells.push({ date: hit.date, col: type, value: Number(hit.value) });
      d.cells.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    }
    if (!_silent) {
      refreshDailyChartCalcKeys();
      renderCalcTables();
      if (!hasAnyDailyDraft()) hideCalcFloat();
    }
  }

  function hasAnyDailyDraft() {
    var b = state.calc.dailyDraft;
    return !!(b && (b.volume || b.amount));
  }
  function hasAnyIntradayDraft() {
    var b = state.calc.intradayDraft;
    return !!(b && (b.volume || b.amount));
  }

  function cancelDailyDraft(type) {
    if (type) {
      state.calc.dailyDraft[type] = null;
    } else {
      state.calc.dailyDraft = { volume: null, amount: null };
    }
    refreshDailyChartCalcKeys();
    if (hasAnyDailyDraft()) updateCalcFloat(); else hideCalcFloat();
    renderCalcTables();
  }

  function doSaveDailyCalc(type, name) {
    var d = state.calc.dailyDraft[type];
    if (!d || d.cells.length === 0) return;
    if (!state.activeStockId) return toast('请先选择股票');
    var sum = d.cells.reduce(function (s, c) { return s + (Number(c.value) || 0); }, 0);
    var payload = {
      calc_name: (name || '').trim() || '未命名',
      calc_type: d.type,
      calc_value: sum,
      source: d.cells.slice(),
      scope: 'daily',
      intraday_kline_id: null
    };
    Zion.saveCalc(state.activeStockId, payload).then(function (id) {
      var rec = Object.assign({}, payload, { id: Number(id) });
      state.calc.daily.push(rec);
      state.calc.dailyDraft[type] = null;
      refreshDailyChartCalcKeys();
      if (hasAnyDailyDraft()) updateCalcFloat(); else hideCalcFloat();
      renderCalcTables();
      toast('已保存：' + payload.calc_name);
    }).catch(function (e) {
      toast('保存失败: ' + e.message);
      console.error(e);
    });
  }

  function deleteDailyCalc(id) {
    var idx = -1;
    for (var i = 0; i < state.calc.daily.length; i++) {
      if (state.calc.daily[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return;
    if (!confirm('确定删除「' + state.calc.daily[idx].calc_name + '」？')) return;
    Zion.deleteCalc(id).then(function () {
      state.calc.daily.splice(idx, 1);
      refreshDailyChartCalcKeys();
      renderCalcTables();
    }).catch(function (e) {
      toast('删除失败: ' + e.message);
    });
  }

  // ----- 分时：双击量/额格子 -----
  function onIntradayCellDblclick(hit) {
    if (!state.calc.mode) {
      toast('请先打开「计算」开关');
      return;
    }
    addToIntradayDraft(hit);
    showCalcFloat('intraday', hit.screen);
  }

  function onIntradayCellRangeSelect(hits, anchorRect) {
    if (!state.calc.mode) return toast('请先打开「计算」开关');
    if (!hits || hits.length === 0) return;
    for (var i = 0; i < hits.length; i++) addToIntradayDraft(hits[i], true);
    refreshIntradayChartCalcKeys();
    showCalcFloat('intraday', anchorRect);
    renderCalcTables();
  }

  function addToIntradayDraft(hit, _silent) {
    var klineId = getCurrentKlineId();
    if (!klineId) return toast('未取到当前分时的 kline_id');
    var dayIdx = state.intraday.dayIdx;
    var date = state.klineData.dates[dayIdx];

    var bag = state.calc.intradayDraft;
    // 切换到别的分时天时丢弃旧草稿
    if (bag.kline_id != null && bag.kline_id !== klineId) {
      bag.volume = null; bag.amount = null;
    }
    bag.kline_id = klineId;
    bag.date = date;

    var type = hit.col;
    var d = bag[type];
    if (!d) d = bag[type] = { type: type, cells: [] };
    var existIdx = -1;
    for (var i = 0; i < d.cells.length; i++) {
      if (d.cells[i].time === hit.time && d.cells[i].col === type) { existIdx = i; break; }
    }
    if (existIdx >= 0) {
      if (!_silent) {
        d.cells.splice(existIdx, 1);
        if (d.cells.length === 0) bag[type] = null;
      }
    } else {
      d.cells.push({ date: date, time: hit.time, col: type, value: Number(hit.value) });
      d.cells.sort(function (a, b) { return a.time < b.time ? -1 : 1; });
    }
    if (!_silent) {
      refreshIntradayChartCalcKeys();
      renderCalcTables();
      if (!hasAnyIntradayDraft()) hideCalcFloat();
    }
  }

  function cancelIntradayDraft(type) {
    var bag = state.calc.intradayDraft;
    if (type) {
      bag[type] = null;
    } else {
      bag.volume = null; bag.amount = null; bag.kline_id = null; bag.date = null;
    }
    if (!hasAnyIntradayDraft()) {
      bag.kline_id = null; bag.date = null;
    }
    refreshIntradayChartCalcKeys();
    if (hasAnyIntradayDraft()) updateCalcFloat(); else hideCalcFloat();
    renderCalcTables();
  }

  function doSaveIntradayCalc(type, name) {
    var bag = state.calc.intradayDraft;
    var d = bag[type];
    if (!d || d.cells.length === 0) return;
    if (!state.activeStockId) return toast('请先选择股票');
    var sum = d.cells.reduce(function (s, c) { return s + (Number(c.value) || 0); }, 0);
    var payload = {
      calc_name: (name || '').trim() || '未命名',
      calc_type: d.type,
      calc_value: sum,
      source: d.cells.slice(),
      scope: 'intraday',
      intraday_kline_id: bag.kline_id
    };
    Zion.saveCalc(state.activeStockId, payload).then(function (id) {
      var rec = Object.assign({}, payload, { id: Number(id) });
      state.calc.intraday.push(rec);
      bag[type] = null;
      if (!hasAnyIntradayDraft()) { bag.kline_id = null; bag.date = null; }
      refreshIntradayChartCalcKeys();
      if (hasAnyIntradayDraft()) updateCalcFloat(); else hideCalcFloat();
      renderCalcTables();
      toast('已保存：' + payload.calc_name);
    }).catch(function (e) {
      toast('保存失败: ' + e.message);
      console.error(e);
    });
  }

  function deleteIntradayCalc(id) {
    var idx = -1;
    for (var i = 0; i < state.calc.intraday.length; i++) {
      if (state.calc.intraday[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return;
    if (!confirm('确定删除「' + state.calc.intraday[idx].calc_name + '」？')) return;
    Zion.deleteCalc(id).then(function () {
      state.calc.intraday.splice(idx, 1);
      refreshIntradayChartCalcKeys();
      renderCalcTables();
    }).catch(function (e) {
      toast('删除失败: ' + e.message);
    });
  }

  // ----- 同步给 chart 的高亮键 -----
  function getDailyDraftKeys() {
    var s = new Set();
    var bag = state.calc.dailyDraft;
    ['volume', 'amount'].forEach(function (t) {
      var d = bag[t];
      if (!d) return;
      for (var i = 0; i < d.cells.length; i++) s.add(d.cells[i].date + '|' + d.cells[i].col);
    });
    return s;
  }
  function getDailySavedKeys() {
    var s = new Set();
    var arr = state.calc.daily;
    for (var i = 0; i < arr.length; i++) {
      var src = arr[i].source || [];
      for (var j = 0; j < src.length; j++) s.add(src[j].date + '|' + src[j].col);
    }
    return s;
  }
  function getIntradayDraftKeys() {
    var s = new Set();
    var bag = state.calc.intradayDraft;
    var klineId = getCurrentKlineId();
    if (bag.kline_id !== klineId) return s;
    ['volume', 'amount'].forEach(function (t) {
      var d = bag[t];
      if (!d) return;
      for (var i = 0; i < d.cells.length; i++) s.add(d.cells[i].time + '|' + d.cells[i].col);
    });
    return s;
  }
  function getIntradaySavedKeys() {
    var s = new Set();
    var klineId = getCurrentKlineId();
    if (klineId == null) return s;
    var arr = state.calc.intraday;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].intraday_kline_id !== klineId) continue;
      var src = arr[i].source || [];
      for (var j = 0; j < src.length; j++) s.add(src[j].time + '|' + src[j].col);
    }
    return s;
  }

  function refreshDailyChartCalcKeys() {
    if (!state.chart) return;
    state.chart.update({
      calcDraftKeys: getDailyDraftKeys(),
      calcSavedKeys: getDailySavedKeys()
    });
  }
  function refreshIntradayChartCalcKeys() {
    if (!state.intraday.chart) return;
    state.intraday.chart.update({
      calcDraftKeys: getIntradayDraftKeys(),
      calcSavedKeys: getIntradaySavedKeys()
    });
  }

  // ----- 渲染计算表 -----
  function fmtCalcValue(value, type) {
    if (value == null || !isFinite(value)) return '-';
    var av = Math.abs(value);
    if (type === 'amount') {
      if (av >= 1e8) return (value / 1e8).toFixed(2) + ' 亿元';
      if (av >= 1e4) return (value / 1e4).toFixed(2) + ' 万元';
      return Math.round(value).toLocaleString() + ' 元';
    }
    // volume：股
    if (av >= 1e8) return (value / 1e8).toFixed(2) + ' 亿股';
    if (av >= 1e4) return (value / 1e4).toFixed(2) + ' 万股';
    return Math.round(value).toLocaleString() + ' 股';
  }
  // 仅数字（表格里用 / 不显示单位）：保持与 fmtCalcValue 同样的量级换算，避免混淆
  function fmtCalcValueNumOnly(value, type) {
    if (value == null || !isFinite(value)) return '-';
    var av = Math.abs(value);
    if (av >= 1e8) return (value / 1e8).toFixed(2);
    if (av >= 1e4) return (value / 1e4).toFixed(2);
    return Math.round(value).toLocaleString();
  }
  // 分时计算表专用：成交额一律按「亿」显示，附「亿」字单位；成交量沿用自适应
  function fmtIntradayCalcValue(value, type) {
    if (value == null || !isFinite(value)) return '-';
    if (type === 'amount') {
      return (value / 1e8).toFixed(2) + ' 亿';
    }
    return fmtCalcValueNumOnly(value, type);
  }
  function shortDate(d) {        // '2026-01-15' → '0115'
    if (!d) return '';
    return d.slice(5).replace('-', '');
  }
  function dateRangeStr(cells) {
    if (!cells || cells.length === 0) return '';
    var dates = cells.map(function (c) { return c.date; }).sort();
    if (dates[0] === dates[dates.length - 1]) return shortDate(dates[0]);
    return shortDate(dates[0]) + '-' + shortDate(dates[dates.length - 1]);
  }
  function timeRangeStr(cells) {
    if (!cells || cells.length === 0) return '';
    var times = cells.map(function (c) { return c.time || ''; }).sort();
    if (times[0] === times[times.length - 1]) return times[0];
    return times[0] + '-' + times[times.length - 1];
  }
  function typeTagHtml(type) {
    if (type === 'volume') return '<span class="calc-type-tag t-volume">量</span>';
    return '<span class="calc-type-tag t-amount">额</span>';
  }

  function renderCalcTables() {
    // 整张计算卡片：仅当「计算模式」开启 + 已选股票时显示
    if (!els.calcSec) return;
    if (!state.activeStockId || !state.calc.mode) {
      els.calcSec.style.display = 'none';
      return;
    }
    els.calcSec.style.display = '';
    renderCalcDailyTable();
    renderCalcIntradayTable();
  }

  function buildColgroup(n) {
    var s = '<colgroup><col class="calc-col-label">';
    for (var i = 0; i < n; i++) s += '<col class="calc-col-data">';
    return s + '</colgroup>';
  }

  function renderCalcDailyTable() {
    var saved = state.calc.daily;

    if (saved.length === 0) {
      els.calcDailyTable.style.display = 'none';
      els.calcDailyEmpty.style.display = '';
      return;
    }
    els.calcDailyTable.style.display = '';
    els.calcDailyEmpty.style.display = 'none';

    var tr1 = '<tr class="calc-row-name"><td class="calc-label">计算名字</td>';
    var tr2 = '<tr class="calc-row-value"><td class="calc-label">计算结果</td>';
    var tr3 = '<tr class="calc-row-aux"><td class="calc-label">日期范围</td>';
    for (var i = 0; i < saved.length; i++) {
      var c = saved[i];
      tr1 += '<td>' + escapeHtml(c.calc_name) + typeTagHtml(c.calc_type) +
        '<button class="calc-del" data-action="del-daily" data-id="' + c.id + '" title="删除">×</button></td>';
      tr2 += '<td>' + fmtCalcValueNumOnly(c.calc_value, c.calc_type) + '</td>';
      tr3 += '<td>' + dateRangeStr(c.source) + '</td>';
    }
    tr1 += '</tr>'; tr2 += '</tr>'; tr3 += '</tr>';
    els.calcDailyTable.innerHTML = buildColgroup(saved.length) + '<tbody>' + tr1 + tr2 + tr3 + '</tbody>';
  }

  function renderCalcIntradayTable() {
    // 按日期升序，同日期再按时间升序排列；日期越小越靠左
    var saved = state.calc.intraday.slice().sort(function (a, b) {
      var da = (a.source && a.source[0] && a.source[0].date) || '';
      var db = (b.source && b.source[0] && b.source[0].date) || '';
      if (da !== db) return da < db ? -1 : 1;
      var ta = (a.source && a.source[0] && a.source[0].time) || '';
      var tb = (b.source && b.source[0] && b.source[0].time) || '';
      return ta < tb ? -1 : (ta > tb ? 1 : 0);
    });

    if (saved.length === 0) {
      els.calcIntradayTable.style.display = 'none';
      els.calcIntradayEmpty.style.display = '';
      return;
    }
    els.calcIntradayTable.style.display = '';
    els.calcIntradayEmpty.style.display = 'none';

    var tr1 = '<tr class="calc-row-name"><td class="calc-label">计算名字</td>';
    var tr2 = '<tr class="calc-row-value"><td class="calc-label">计算结果</td>';
    var tr3 = '<tr class="calc-row-aux"><td class="calc-label">日期</td>';
    var tr4 = '<tr class="calc-row-aux"><td class="calc-label">时间</td>';
    for (var i = 0; i < saved.length; i++) {
      var c = saved[i];
      var srcDate = (c.source && c.source[0]) ? c.source[0].date : '';
      tr1 += '<td>' + escapeHtml(c.calc_name) + typeTagHtml(c.calc_type) +
        '<button class="calc-del" data-action="del-intraday" data-id="' + c.id + '" title="删除">×</button></td>';
      tr2 += '<td>' + fmtIntradayCalcValue(c.calc_value, c.calc_type) + '</td>';
      tr3 += '<td>' + shortDate(srcDate) + '</td>';
      tr4 += '<td>' + timeRangeStr(c.source) + '</td>';
    }
    tr1 += '</tr>'; tr2 += '</tr>'; tr3 += '</tr>'; tr4 += '</tr>';
    els.calcIntradayTable.innerHTML = buildColgroup(saved.length) + '<tbody>' + tr1 + tr2 + tr3 + tr4 + '</tbody>';
  }

  // ============== 草稿浮框 ==============
  function showCalcFloat(scope, anchorRect) {
    state.calc.float.scope = scope;
    state.calc.float.anchorRect = anchorRect || state.calc.float.anchorRect;
    updateCalcFloat();
  }

  function updateCalcFloat() {
    var scope = state.calc.float.scope;
    if (!scope || !els.calcFloat) return;
    var bag = scope === 'daily' ? state.calc.dailyDraft : state.calc.intradayDraft;
    var blocks = [];
    ['volume', 'amount'].forEach(function (type) {
      var d = bag[type];
      if (!d || d.cells.length === 0) return;
      var sum = d.cells.reduce(function (s, c) { return s + (Number(c.value) || 0); }, 0);
      var typeName = scope === 'daily'
        ? (type === 'volume' ? '成交量' : '成交额')
        : (type === 'volume' ? '交易量' : '交易额');
      blocks.push(
        '<div class="cf-block">' +
          '<div class="cf-head">' +
            '<span class="cf-tag t-' + type + '">' + typeName + '</span>' +
            '<span class="cf-count">' + d.cells.length + ' 笔</span>' +
          '</div>' +
          '<div class="cf-value">' + escapeHtml(fmtCalcValue(sum, type)) + '</div>' +
          '<div class="cf-actions">' +
            '<button class="cf-btn ok" data-act="save" data-type="' + type + '" title="保存">✓ 保存</button>' +
            '<button class="cf-btn cancel" data-act="cancel" data-type="' + type + '" title="取消">✗ 取消</button>' +
          '</div>' +
        '</div>'
      );
    });
    if (blocks.length === 0) { hideCalcFloat(); return; }
    els.calcFloat.innerHTML = blocks.join('<div class="cf-divider"></div>');
    els.calcFloat.style.display = '';
    positionCalcFloat();
  }

  function hideCalcFloat() {
    state.calc.float.scope = null;
    state.calc.float.anchorRect = null;
    state.calc.float.pendingType = null;
    if (els.calcFloat) els.calcFloat.style.display = 'none';
  }

  function positionCalcFloat() {
    var rect = state.calc.float.anchorRect;
    if (!rect) return;
    var fl = els.calcFloat;
    var fw = fl.offsetWidth || 180;
    var fh = fl.offsetHeight || 70;
    var pad = 8;

    // 默认：格子右上角 → 浮框紧贴在格子的右上方
    var left = rect.right + pad;
    var top = rect.top - fh - pad;

    // 视口边界保护
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    if (left + fw > vw - 4) left = rect.left - fw - pad;            // 右侧放不下，挪到左侧
    if (left < 4) left = Math.max(4, rect.left + (rect.right - rect.left) / 2 - fw / 2);
    if (top < 4) top = rect.bottom + pad;                            // 上方放不下，挪到下方
    if (top + fh > vh - 4) top = vh - fh - 4;

    fl.style.left = Math.round(left) + 'px';
    fl.style.top = Math.round(top) + 'px';
  }

  // ============== 保存计算 modal ==============
  function openCalcModal(type) {
    var scope = state.calc.float.scope;
    if (!scope || !type) return;
    var bag = scope === 'daily' ? state.calc.dailyDraft : state.calc.intradayDraft;
    var draft = bag[type];
    if (!draft || draft.cells.length === 0) return;
    state.calc.float.pendingType = type;

    var sum = draft.cells.reduce(function (s, c) { return s + (Number(c.value) || 0); }, 0);
    var typeName = scope === 'daily'
      ? (type === 'volume' ? '成交量' : '成交额')
      : (type === 'volume' ? '交易量' : '交易额');
    var rangeText;
    if (scope === 'daily') {
      rangeText = '日期范围：' + dateRangeStr(draft.cells);
    } else {
      rangeText = shortDate(bag.date) + '  ' + timeRangeStr(draft.cells);
    }
    els.calcModalSummary.innerHTML =
      '<div>类型：' + typeName + ' · ' + draft.cells.length + ' 笔</div>' +
      '<div style="margin-top:4px">累加结果：<b>' + fmtCalcValue(sum, type) + '</b></div>' +
      '<div style="margin-top:4px;color:var(--text-4)">' + rangeText + '</div>';

    els.calcModalTitle.value = '';
    els.calcModalMask.classList.add('show');
    setTimeout(function () { els.calcModalTitle.focus(); }, 50);
  }
  function closeCalcModal() {
    els.calcModalMask.classList.remove('show');
  }
  function submitCalcModal() {
    var name = els.calcModalTitle.value.trim();
    if (!name) {
      els.calcModalTitle.focus();
      return toast('请输入标题');
    }
    var scope = state.calc.float.scope;
    var type = state.calc.float.pendingType;
    closeCalcModal();
    if (!type) return;
    if (scope === 'daily') doSaveDailyCalc(type, name);
    else if (scope === 'intraday') doSaveIntradayCalc(type, name);
  }

  // 计算面板内的 click 委托（仅删除已保存项）+ 浮框 / modal 按钮
  function bindCalcHandlers() {
    if (!els.calcSec) return;

    els.calcMode.addEventListener('change', function () {
      state.calc.mode = els.calcMode.checked;
      // 同步 chart 的"框选模式可用"标志
      if (state.chart) state.chart.update({ calcModeEnabled: state.calc.mode });
      if (state.intraday.chart) state.intraday.chart.update({ calcModeEnabled: state.calc.mode });
      // 关闭时丢弃所有未保存草稿
      if (!state.calc.mode) {
        state.calc.dailyDraft = { volume: null, amount: null };
        state.calc.intradayDraft = { volume: null, amount: null, kline_id: null, date: null };
        refreshDailyChartCalcKeys();
        refreshIntradayChartCalcKeys();
        hideCalcFloat();
      }
      renderCalcTables();
    });

    els.calcSec.addEventListener('click', function (e) {
      var t = e.target.closest('[data-action]');
      if (!t) return;
      var action = t.getAttribute('data-action');
      if (action === 'del-daily') {
        deleteDailyCalc(+t.getAttribute('data-id'));
      } else if (action === 'del-intraday') {
        deleteIntradayCalc(+t.getAttribute('data-id'));
      }
    });

    // 草稿浮框按钮（事件委托：每个 type 一对 ✓ ✗）
    els.calcFloat.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      var type = btn.getAttribute('data-type');
      if (!type) return;
      if (act === 'save') {
        openCalcModal(type);
      } else if (act === 'cancel') {
        var scope = state.calc.float.scope;
        if (scope === 'daily') cancelDailyDraft(type);
        else if (scope === 'intraday') cancelIntradayDraft(type);
      }
    });

    // 保存 modal 按钮
    els.calcModalCancel.addEventListener('click', closeCalcModal);
    els.calcModalSubmit.addEventListener('click', submitCalcModal);
    els.calcModalTitle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitCalcModal();
    });
    els.calcModalMask.addEventListener('click', function (e) {
      if (e.target === els.calcModalMask) closeCalcModal();
    });

    // 滚动时直接隐藏浮框（cell 视口位置已变，再贴在原坐标会与数字错位）
    window.addEventListener('scroll', function () {
      if (els.calcFloat.style.display !== 'none') hideCalcFloat();
    }, true);
    window.addEventListener('resize', function () {
      if (els.calcFloat.style.display !== 'none') positionCalcFloat();
    });

    // ====== 「按区间累加」弹窗事件 ======
    if (els.btnIntervalCalc) {
      els.btnIntervalCalc.addEventListener('click', openIntervalCalcModal);
      els.intervalCancel.addEventListener('click', closeIntervalCalcModal);
      els.intervalSubmit.addEventListener('click', submitIntervalCalc);
      els.intervalModalMask.addEventListener('click', function (e) {
        if (e.target === els.intervalModalMask) closeIntervalCalcModal();
      });
      // 任意输入变化都重算
      ['change', 'input'].forEach(function (ev) {
        els.intervalDate.addEventListener(ev, recalcIntervalDebounced);
        els.intervalStart.addEventListener(ev, recalcIntervalDebounced);
        els.intervalEnd.addEventListener(ev, recalcIntervalDebounced);
      });
      els.intervalTitle.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submitIntervalCalc();
      });
      // 分时图竖线拖动（只绑一次）
      _bindIntervalChartDragHandlers();
    }
  }

  // ============== 按区间累加（分时成交额） ==============
  var _intervalRecalcTimer = null;
  function recalcIntervalDebounced() {
    clearTimeout(_intervalRecalcTimer);
    _intervalRecalcTimer = setTimeout(recalcInterval, 200);
  }

  function openIntervalCalcModal() {
    if (!state.activeStockId) return toast('请先选择股票');
    if (!state.klineData || !state.klineData.dates || state.klineData.dates.length === 0) {
      return toast('当前股票没有 K 线数据');
    }
    var dates = state.klineData.dates;
    // 默认选当前 hover 的日期 / 已打开分时的日期 / 最后一天
    var defaultIdx = dates.length - 1;
    if (state.intraday.open && state.intraday.dayIdx >= 0) {
      defaultIdx = state.intraday.dayIdx;
    }
    els.intervalDate.min = dates[0];
    els.intervalDate.max = dates[dates.length - 1];
    els.intervalDate.value = dates[defaultIdx];
    if (els.intervalDateHint) {
      els.intervalDateHint.textContent =
        '（可直接键入；数据范围 ' + dates[0] + ' ~ ' + dates[dates.length - 1] + '）';
    }
    els.intervalStart.value = '09:30';
    els.intervalEnd.value = '11:30';
    els.intervalTitle.value = '';
    els.intervalResultValue.textContent = '—';
    if (els.intervalChartEmpty) {
      els.intervalChartEmpty.style.display = '';
      els.intervalChartEmpty.textContent = '加载分时数据 …';
    }
    state.calc._intervalLoaded = null;
    els.intervalModalMask.classList.add('show');
    // 等下一帧让 wrap 拿到正确的尺寸再画
    setTimeout(function () {
      els.intervalDate.focus();
      recalcInterval();
    }, 30);
  }

  function closeIntervalCalcModal() {
    els.intervalModalMask.classList.remove('show');
    state.calc._intervalLoaded = null;
    if (els.intervalChart) {
      var ctx = els.intervalChart.getContext('2d');
      ctx && ctx.clearRect(0, 0, els.intervalChart.width, els.intervalChart.height);
    }
    if (els.intervalChartEmpty) {
      els.intervalChartEmpty.style.display = '';
      els.intervalChartEmpty.textContent = '选择日期后显示分时走势';
    }
  }

  // 内部：拿当天 ticks（缓存优先）
  function _fetchTicksForDayIdx(dayIdx) {
    var stockId = state.activeStockId;
    var klineId = state.klineData.klineIds ? state.klineData.klineIds[dayIdx] : null;
    var cacheKey = state.isDemo ? ('demo_' + stockId + '_' + dayIdx)
                                : (klineId != null ? ('k_' + klineId) : null);
    if (cacheKey && state.intradayCache[cacheKey]) {
      return Promise.resolve(state.intradayCache[cacheKey]);
    }
    var p;
    if (state.isDemo) p = fetchDemoIntraday(dayIdx);
    else if (klineId != null) p = Zion.getIntraday(klineId);
    else p = Promise.reject(new Error('未取到 kline_id'));
    return p.then(function (ticks) {
      if (cacheKey) state.intradayCache[cacheKey] = ticks || [];
      return ticks || [];
    });
  }

  function recalcInterval() {
    var dates = state.klineData && state.klineData.dates;
    if (!dates || dates.length === 0) return;
    var dateStr = els.intervalDate.value || '';
    // 输入未完成（年份还没填够 4 位 / 异常）→ 等下次
    if (dateStr.length !== 10) return;
    var y = parseInt(dateStr.slice(0, 4), 10);
    if (!(y >= 1990 && y <= 2999)) return;

    // 反查在 dates 数组中的索引；非交易日自动 fallback 到 ≤ dateStr 的最大日期
    var dayIdx = dates.indexOf(dateStr);
    var fallback = false;
    if (dayIdx < 0) {
      for (var i = dates.length - 1; i >= 0; i--) {
        if (dates[i] <= dateStr) { dayIdx = i; break; }
      }
      if (dayIdx < 0) dayIdx = 0;   // 输入早于第一天 → 取第一天
      fallback = true;
      // 把输入框矫正到生效日期，便于用户看到
      els.intervalDate.value = dates[dayIdx];
    }

    var startT = els.intervalStart.value || '09:30';
    var endT = els.intervalEnd.value || '15:00';
    if (startT > endT) { var tmp = startT; startT = endT; endT = tmp; }
    els.intervalResultValue.textContent = '加载中 …';
    _fetchTicksForDayIdx(dayIdx).then(function (ticks) {
      if (!ticks || ticks.length === 0) {
        els.intervalResultValue.textContent = '无数据';
        state.calc._intervalLoaded = null;
        drawIntervalChart(null, null, null);
        if (els.intervalChartEmpty) {
          els.intervalChartEmpty.style.display = '';
          els.intervalChartEmpty.textContent = '该日没有分时数据';
        }
        return;
      }
      var total = 0; var n = 0;
      for (var i = 0; i < ticks.length; i++) {
        var t = ticks[i].t;
        if (!t) continue;
        if (t >= startT && t <= endT) {
          total += Number(ticks[i].a) || 0;
          n++;
        }
      }
      state.calc._intervalLoaded = {
        dayIdx: dayIdx,
        date: state.klineData.dates[dayIdx],
        startT: startT,
        endT: endT,
        total: total,
        n: n
      };
      els.intervalResultValue.textContent = (total / 1e8).toFixed(2) + ' 亿元';
      // 拿昨收：dayIdx-1 的 close（与双击日 K 弹出的分时浮窗保持一致）
      var prevClose = (dayIdx > 0 && state.klineData.close[dayIdx - 1] != null)
        ? state.klineData.close[dayIdx - 1] : null;
      drawIntervalChart(ticks, startT, endT, prevClose);
    }).catch(function (e) {
      els.intervalResultValue.textContent = '加载失败';
      state.calc._intervalLoaded = null;
      drawIntervalChart(null, null, null);
      if (els.intervalChartEmpty) {
        els.intervalChartEmpty.style.display = '';
        els.intervalChartEmpty.textContent = '加载失败：' + (e.message || e);
      }
    });
  }

  // 拖动状态（在外层闭包，给事件用）
  var _intervalChartCtx = null;     // 最近一次绘制的 layout
  var _intervalDrag = null;         // {which:'start'|'end', startX:number}

  // 弹窗右侧分时图（轻量版，与双击日 K 出现的分时浮窗保持一致风格：
  // 蓝色折线 + 昨收虚线参考 + 不画面积 + Y 轴包含昨收）
  function drawIntervalChart(ticks, startT, endT, prevClose) {
    var canvas = els.intervalChart;
    var wrap = els.intervalChartWrap;
    if (!canvas || !wrap) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var W = wrap.clientWidth || 640;
    var H = wrap.clientHeight || 280;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    if (!ticks || ticks.length === 0) {
      if (els.intervalChartEmpty) els.intervalChartEmpty.style.display = '';
      _intervalChartCtx = null;
      return;
    }
    if (els.intervalChartEmpty) els.intervalChartEmpty.style.display = 'none';

    // 同花顺风格：左侧价格、右侧百分比，所以 padR 留宽
    var padL = 56, padR = 52, padT = 14, padB = 24;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;
    if (plotW <= 0 || plotH <= 0) return;

    // 价格区间：同花顺式 —— 以昨收为中轴对称
    // 振幅 amp = max(|today_high - prevClose|, |prevClose - today_low|)
    var rawLo = Infinity, rawHi = -Infinity;
    for (var i = 0; i < ticks.length; i++) {
      var p = ticks[i].p;
      if (p == null) continue;
      if (p < rawLo) rawLo = p;
      if (p > rawHi) rawHi = p;
    }
    if (!isFinite(rawLo)) return;

    var lo, hi, span, pcRef = null;
    if (prevClose != null && isFinite(prevClose) && prevClose > 0) {
      pcRef = prevClose;
      var amp = Math.max(Math.abs(rawHi - prevClose), Math.abs(prevClose - rawLo));
      if (!(amp > 0)) amp = prevClose * 0.005 || 0.02;
      amp *= 1.06;
      lo = prevClose - amp;
      hi = prevClose + amp;
      span = hi - lo;
    } else {
      // 无昨收时，退化为普通自适应
      var pad = (rawHi - rawLo) * 0.08 || (rawLo * 0.005) || 0.02;
      lo = rawLo - pad; hi = rawHi + pad;
      span = (hi - lo) || 1;
    }

    function xOfIdx(i) {
      if (ticks.length <= 1) return padL + plotW / 2;
      return padL + plotW * i / (ticks.length - 1);
    }
    function yOfPrice(p) {
      return padT + plotH * (1 - (p - lo) / span);
    }
    function findTimeRange(s, e) {
      var si = -1, ei = -1;
      for (var i = 0; i < ticks.length; i++) {
        var t = ticks[i].t;
        if (!t) continue;
        if (si < 0 && t >= s) si = i;
        if (t <= e) ei = i;
      }
      return [si, ei];
    }

    // 1) 黄色背景：选中区间（先画在最底层）
    if (startT && endT) {
      var range = findTimeRange(startT, endT);
      if (range[0] >= 0 && range[1] >= range[0]) {
        var x0 = xOfIdx(range[0]);
        var x1 = xOfIdx(range[1]);
        ctx.fillStyle = 'rgba(250, 204, 21, 0.30)';
        ctx.fillRect(x0, padT, Math.max(2, x1 - x0), plotH);
      }
    }

    // 2) Y 网格 + 双轴刻度
    //    左轴：价格（涨红、跌绿、中线 = 昨收 用灰）
    //    右轴：相对昨收的百分比（涨红、跌绿、中线 0.00% 用灰）
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    var GRID_N = 4;
    for (var k = 0; k <= GRID_N; k++) {
      var gy = padT + plotH * k / GRID_N;
      var gv = hi - span * k / GRID_N;
      // 网格横线
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(W - padR, gy);
      ctx.stroke();
      // 价格 / 百分比标签颜色：涨红 / 跌绿 / 平灰
      var color = '#9ca3af';
      var pctText = '';
      if (pcRef != null) {
        var diff = gv - pcRef;
        var pct = diff / pcRef * 100;
        if (Math.abs(pct) < 0.005) {
          color = '#6b7280';
          pctText = '0.00%';
        } else if (pct > 0) {
          color = '#dc2626';
          pctText = '+' + pct.toFixed(2) + '%';
        } else {
          color = '#16a34a';
          pctText = pct.toFixed(2) + '%';
        }
      }
      // 左侧价格
      ctx.fillStyle = color;
      ctx.textAlign = 'right';
      ctx.fillText(gv.toFixed(2), padL - 6, gy + 0.5);
      // 右侧百分比
      if (pctText) {
        ctx.textAlign = 'left';
        ctx.fillText(pctText, W - padR + 6, gy + 0.5);
      }
    }

    // 3) 昨收水平参考线（虚线，加粗一点点更易识别）
    if (pcRef != null) {
      var yPC = yOfPrice(pcRef);
      ctx.strokeStyle = '#9ca3af';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, yPC);
      ctx.lineTo(W - padR, yPC);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 4) 蓝色分时折线（与 IntradayChart 一致：#2563eb，无面积填充）
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    var moved = false;
    for (var j = 0; j < ticks.length; j++) {
      if (ticks[j].p == null) continue;
      var xx = xOfIdx(j), yy = yOfPrice(ticks[j].p);
      if (!moved) { ctx.moveTo(xx, yy); moved = true; }
      else ctx.lineTo(xx, yy);
    }
    ctx.stroke();

    // 5) 起止橙色竖线 + 时间标签
    if (startT && endT) {
      var rng = findTimeRange(startT, endT);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.6;
      ctx.fillStyle = '#f59e0b';
      ctx.font = '11px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      if (rng[0] >= 0) {
        var sx = xOfIdx(rng[0]);
        ctx.beginPath();
        ctx.moveTo(sx, padT); ctx.lineTo(sx, padT + plotH);
        ctx.stroke();
        ctx.fillText(ticks[rng[0]].t, sx, padT + plotH + 6);
      }
      if (rng[1] >= 0 && rng[1] !== rng[0]) {
        var ex = xOfIdx(rng[1]);
        ctx.beginPath();
        ctx.moveTo(ex, padT); ctx.lineTo(ex, padT + plotH);
        ctx.stroke();
        ctx.fillText(ticks[rng[1]].t, ex, padT + plotH + 6);
      }
    }

    // 6) X 轴常规时间标签
    var stdLabels = ['09:30', '10:30', '11:30', '13:30', '14:30'];
    ctx.fillStyle = '#9ca3af';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (var lt = 0; lt < stdLabels.length; lt++) {
      for (var ii = 0; ii < ticks.length; ii++) {
        if (ticks[ii].t === stdLabels[lt]) {
          var lx = xOfIdx(ii);
          ctx.fillText(stdLabels[lt], lx, padT + plotH + 6);
          break;
        }
      }
    }

    // 保存 layout，供拖动用
    var rngForCtx = (startT && endT) ? findTimeRange(startT, endT) : [-1, -1];
    _intervalChartCtx = {
      ticks: ticks,
      padL: padL, padR: padR, padT: padT, padB: padB,
      plotW: plotW, plotH: plotH, W: W, H: H,
      startIdx: rngForCtx[0],
      endIdx: rngForCtx[1],
      xOfIdx: xOfIdx,
      pxToIdx: function (px) {
        if (ticks.length <= 1) return 0;
        var ratio = (px - padL) / plotW;
        if (ratio < 0) ratio = 0;
        if (ratio > 1) ratio = 1;
        var idx = Math.round(ratio * (ticks.length - 1));
        if (idx < 0) idx = 0;
        if (idx > ticks.length - 1) idx = ticks.length - 1;
        return idx;
      }
    };
    // 鼠标位置游标更新（外部 mousemove 时调用 _updateIntervalChartCursor）
  }

  // ====== 分时图竖线拖动支持 ======
  function _hitTestIntervalLine(px) {
    var c = _intervalChartCtx;
    if (!c) return null;
    if (px < c.padL - 12 || px > c.padL + c.plotW + 12) return null;
    var TOL = 8;
    var sX = c.startIdx >= 0 ? c.xOfIdx(c.startIdx) : -999;
    var eX = c.endIdx >= 0 ? c.xOfIdx(c.endIdx) : -999;
    var dS = Math.abs(px - sX);
    var dE = Math.abs(px - eX);
    if (dS <= TOL && dS <= dE) return 'start';
    if (dE <= TOL) return 'end';
    return null;
  }

  function _bindIntervalChartDragHandlers() {
    var canvas = els.intervalChart;
    if (!canvas) return;

    canvas.addEventListener('mousemove', function (e) {
      var c = _intervalChartCtx;
      if (!c) { canvas.style.cursor = ''; return; }
      var rect = canvas.getBoundingClientRect();
      var px = e.clientX - rect.left;
      if (_intervalDrag) {
        var idx = c.pxToIdx(px);
        var ticks = c.ticks;
        var t = (ticks[idx] && ticks[idx].t) || null;
        if (!t) return;
        if (_intervalDrag.which === 'start') {
          // 不能超过 endIdx
          if (c.endIdx >= 0 && idx > c.endIdx) idx = c.endIdx;
          t = ticks[idx].t;
          els.intervalStart.value = t;
          c.startIdx = idx;
        } else {
          if (c.startIdx >= 0 && idx < c.startIdx) idx = c.startIdx;
          t = ticks[idx].t;
          els.intervalEnd.value = t;
          c.endIdx = idx;
        }
        // 立即重绘（不重新拉数据，但要重算总额，所以走 recalcInterval 的简化路径）
        _recalcIntervalUseCachedTicks();
        return;
      }
      // 非拖动：检测命中并改鼠标样式
      var hit = _hitTestIntervalLine(px);
      canvas.style.cursor = hit ? 'ew-resize' : '';
    });

    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      var c = _intervalChartCtx;
      if (!c) return;
      var rect = canvas.getBoundingClientRect();
      var px = e.clientX - rect.left;
      var hit = _hitTestIntervalLine(px);
      if (!hit) return;
      _intervalDrag = { which: hit };
      e.preventDefault();
    });

    function endDrag() {
      if (!_intervalDrag) return;
      _intervalDrag = null;
      canvas.style.cursor = '';
      // 触发 change 让 recalcIntervalDebounced 走完整流程（其实已经在拖动中实时算好了，这里只是兜底）
    }

    window.addEventListener('mouseup', endDrag);
    canvas.addEventListener('mouseleave', function () {
      if (!_intervalDrag) canvas.style.cursor = '';
    });
  }

  // 拖动竖线时，不重新拉 ticks，直接基于 _intervalChartCtx 里的 ticks 重算 + 重绘
  function _recalcIntervalUseCachedTicks() {
    var c = _intervalChartCtx;
    if (!c) return;
    var ticks = c.ticks;
    var startT = els.intervalStart.value;
    var endT = els.intervalEnd.value;
    if (!startT || !endT) return;
    if (startT > endT) { var tmp = startT; startT = endT; endT = tmp; }
    var total = 0, n = 0;
    for (var i = 0; i < ticks.length; i++) {
      var t = ticks[i].t;
      if (!t) continue;
      if (t >= startT && t <= endT) { total += Number(ticks[i].a) || 0; n++; }
    }
    var dayIdx = (state.calc._intervalLoaded && state.calc._intervalLoaded.dayIdx) || 0;
    var date = state.klineData.dates[dayIdx];
    state.calc._intervalLoaded = {
      dayIdx: dayIdx, date: date, startT: startT, endT: endT, total: total, n: n
    };
    els.intervalResultValue.textContent = (total / 1e8).toFixed(2) + ' 亿元';
    var prevClose = (dayIdx > 0 && state.klineData.close[dayIdx - 1] != null)
      ? state.klineData.close[dayIdx - 1] : null;
    drawIntervalChart(ticks, startT, endT, prevClose);
  }

  function submitIntervalCalc() {
    var info = state.calc._intervalLoaded;
    if (!info) return toast('请等待计算结果出现');
    var klineId = state.klineData.klineIds ? state.klineData.klineIds[info.dayIdx] : null;
    if (klineId == null) return toast('该日没有 kline_id，无法保存');
    var name = (els.intervalTitle.value || '').trim();
    if (!name) name = info.startT + '-' + info.endT + ' 成交额';
    var payload = {
      calc_name: name,
      calc_type: 'amount',
      calc_value: info.total,
      source: [{
        date: info.date,
        time: info.startT + '~' + info.endT,
        col: 'amount',
        value: info.total
      }],
      scope: 'intraday',
      intraday_kline_id: klineId
    };
    els.intervalSubmit.disabled = true;
    Zion.saveCalc(state.activeStockId, payload).then(function (id) {
      var rec = Object.assign({}, payload, { id: Number(id) });
      state.calc.intraday.push(rec);
      renderCalcTables();
      closeIntervalCalcModal();
      toast('已保存：' + name + '（' + (info.total / 1e8).toFixed(2) + ' 亿）');
    }).catch(function (e) {
      toast('保存失败: ' + e.message);
      console.error(e);
    }).finally(function () {
      els.intervalSubmit.disabled = false;
    });
  }

  // ============== 新建股票 ==============
  function openCreateStockModal() {
    els.modalMask.classList.add('show');
    els.inpName.value = '';
    els.inpCode.value = '';
    setTimeout(function () { els.inpName.focus(); }, 50);
  }
  function closeModal() { els.modalMask.classList.remove('show'); }
  function submitCreateStock() {
    var name = els.inpName.value.trim();
    var code = els.inpCode.value.trim();
    if (!name) return toast('请输入股票名称');
    if (!code) return toast('请输入股票代码');
    els.btnSubmit.disabled = true;
    els.btnSubmit.textContent = '创建中...';
    Zion.createStock(name, code).then(function (id) {
      toast('已创建：' + name + ' (' + code + ')');
      closeModal();
      loadStocks().then(function () {
        switchStock(+id);
      });
    }).catch(function (e) {
      toast('创建失败: ' + e.message);
      console.error(e);
    }).finally(function () {
      els.btnSubmit.disabled = false;
      els.btnSubmit.textContent = '确定';
    });
  }

  // ============== Loading & Status ==============
  function showLoading(msg) {
    var ov = els.loadingOverlay;
    ov.querySelector('.loading-text').textContent = msg || '加载中...';
    ov.classList.add('show');
  }
  function hideLoading() {
    els.loadingOverlay.classList.remove('show');
  }
  function showStatus(msg) {
    if (els.status) els.status.textContent = msg || '';
  }

  // ============== Init ==============
  function bindElements() {
    els.toast = document.getElementById('toast');
    els.stockList = document.getElementById('stockList');
    els.btnAddStock = document.getElementById('btnAddStock');
    els.chartWrap = document.getElementById('chartWrap');
    els.markerGrid = document.getElementById('markerGrid');
    els.intervalSec = document.getElementById('intervalSec');
    els.markerTags = document.getElementById('markerTags');
    els.status = document.getElementById('status');

    els.btnClear = document.getElementById('btnClear');
    els.btnSelectAll = document.getElementById('btnSelectAll');
    els.btnSave = document.getElementById('btnSave');
    els.btnZoomIn = document.getElementById('btnZoomIn');     // -（少看 1 天）
    els.btnZoomOut = document.getElementById('btnZoomOut');   // +（多看 1 天）
    els.viewSizeInput = document.getElementById('viewSizeInput');
    els.viewDateStart = document.getElementById('viewDateStart');
    els.viewDateEnd = document.getElementById('viewDateEnd');

    els.showAvg = document.getElementById('showAvg');
    els.dpPrice = document.getElementById('dpPrice');
    els.dpAmount = document.getElementById('dpAmount');
    els.dpVolume = document.getElementById('dpVolume');
    els.volUnit = document.getElementById('volUnit');
    els.fontSize = document.getElementById('fontSize');
    els.fsVal = document.getElementById('fsVal');
    els.fsMinus = document.getElementById('fsMinus');
    els.fsPlus = document.getElementById('fsPlus');

    els.modalMask = document.getElementById('modalMask');
    els.inpName = document.getElementById('inpName');
    els.inpCode = document.getElementById('inpCode');
    els.btnSubmit = document.getElementById('btnSubmit');
    els.btnCancel = document.getElementById('btnCancel');

    // 顶部「切换股票」下拉（手机端可见）
    els.mobileStockSwitcher = document.getElementById('mobileStockSwitcher');
    els.mobileStockBtn = document.getElementById('mobileStockBtn');
    els.mobileStockName = document.getElementById('mobileStockName');
    els.mobileStockMenu = document.getElementById('mobileStockMenu');
    els.loadingOverlay = document.getElementById('loadingOverlay');

    els.annotMode = document.getElementById('annotMode');

    els.intradayPop = document.getElementById('intradayPop');
    els.ipSymbol = document.getElementById('ipSymbol');
    els.ipDate = document.getElementById('ipDate');
    els.ipChange = document.getElementById('ipChange');
    els.ipMeta = document.getElementById('ipMeta');
    els.ipClose = document.getElementById('ipClose');
    els.ipCanvas = document.getElementById('ipCanvas');
    els.ipLoading = document.getElementById('ipLoading');
    els.ipEmpty = document.getElementById('ipEmpty');

    // 计算面板
    els.calcSec = document.getElementById('calcSec');
    els.calcMode = document.getElementById('calcMode');
    els.calcDailyTable = document.getElementById('calcDailyTable');
    els.calcDailyEmpty = document.getElementById('calcDailyEmpty');
    els.calcIntradayTable = document.getElementById('calcIntradayTable');
    els.calcIntradayEmpty = document.getElementById('calcIntradayEmpty');

    // 草稿浮框
    els.calcFloat = document.getElementById('calcFloat');
    // 浮框内部由 updateCalcFloat 动态渲染

    // 保存计算 modal
    els.calcModalMask = document.getElementById('calcModalMask');
    els.calcModalSummary = document.getElementById('calcModalSummary');
    els.calcModalTitle = document.getElementById('calcModalTitle');
    els.calcModalCancel = document.getElementById('calcModalCancel');
    els.calcModalSubmit = document.getElementById('calcModalSubmit');

    // 按区间累加 modal
    els.btnIntervalCalc = document.getElementById('btnIntervalCalc');
    els.intervalModalMask = document.getElementById('intervalModalMask');
    els.intervalDate = document.getElementById('intervalDate');
    els.intervalDateHint = document.getElementById('intervalDateHint');
    els.intervalStart = document.getElementById('intervalStart');
    els.intervalEnd = document.getElementById('intervalEnd');
    els.intervalResultValue = document.getElementById('intervalResultValue');
    els.intervalTitle = document.getElementById('intervalTitle');
    els.intervalCancel = document.getElementById('intervalCancel');
    els.intervalSubmit = document.getElementById('intervalSubmit');
    els.intervalChartWrap = document.getElementById('intervalChartWrap');
    els.intervalChart = document.getElementById('intervalChart');
    els.intervalChartEmpty = document.getElementById('intervalChartEmpty');
  }

  function bindHandlers() {
    els.btnAddStock.addEventListener('click', openCreateStockModal);
    els.btnSubmit.addEventListener('click', submitCreateStock);
    els.btnCancel.addEventListener('click', closeModal);
    els.modalMask.addEventListener('click', function (e) {
      if (e.target === els.modalMask) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      // ESC：区间累加 modal > 保存计算 modal > 新建股票 modal > 草稿浮框 > 分时浮窗
      if (e.key === 'Escape') {
        if (els.intervalModalMask && els.intervalModalMask.classList.contains('show')) {
          closeIntervalCalcModal(); return;
        }
        if (els.calcModalMask && els.calcModalMask.classList.contains('show')) {
          closeCalcModal(); return;
        }
        if (els.modalMask.classList.contains('show')) {
          closeModal(); return;
        }
        if (els.calcFloat && els.calcFloat.style.display !== 'none') {
          var scope = state.calc.float.scope;
          if (scope === 'daily') cancelDailyDraft();
          else if (scope === 'intraday') cancelIntradayDraft();
          else hideCalcFloat();
          return;
        }
        if (state.intraday.open) {
          closeIntraday(); return;
        }
      }
      if (e.key === 'Enter' && els.modalMask.classList.contains('show')) {
        if (document.activeElement === els.inpName) { els.inpCode.focus(); return; }
        submitCreateStock();
      }
    });

    els.btnClear.addEventListener('click', clearMarkers);
    els.btnSelectAll.addEventListener('click', selectAllMarkers);
    els.btnSave.addEventListener('click', saveMarkers);
    els.btnZoomIn.addEventListener('click', function () {
      if (state.chart) state.chart.zoomBy(-1);   // 少看 1 天
    });
    els.btnZoomOut.addEventListener('click', function () {
      if (state.chart) state.chart.zoomBy(1);    // 多看 1 天
    });

    // 起止日期：仅 change 时应用（避免边输边触发把 "2025" 提前当 "0025"）
    if (els.viewDateStart && els.viewDateEnd) {
      var lastDateRangeKey = '';
      var validIsoDate = function (s) {
        // 'YYYY-MM-DD' 且年份 ≥ 1990
        if (!s || s.length !== 10) return false;
        var y = parseInt(s.slice(0, 4), 10);
        return y >= 1990 && y <= 2999;
      };
      var applyDateRange = function () {
        if (!state.chart) return;
        var s = els.viewDateStart.value;
        var e = els.viewDateEnd.value;
        if (!validIsoDate(s) || !validIsoDate(e)) return;   // 中间态/异常值直接忽略
        if (s > e) { var tmp = s; s = e; e = tmp; }
        var key = s + '~' + e;
        if (key === lastDateRangeKey) return;
        lastDateRangeKey = key;
        var ret = state.chart.setViewByDateRange(s, e);
        if (ret && (ret.clampedStart || ret.clampedEnd)) {
          var msg = '股票数据范围 ' + ret.dataMin + ' ~ ' + ret.dataMax + '，已按可用范围显示';
          toast(msg, 2400);
        }
      };
      els.viewDateStart.addEventListener('change', applyDateRange);
      els.viewDateEnd.addEventListener('change', applyDateRange);
    }

    // 天数输入框：Enter / 失焦时应用
    if (els.viewSizeInput) {
      var applyViewSize = function () {
        if (!state.chart) return;
        var v = parseInt(els.viewSizeInput.value, 10);
        if (!isFinite(v) || v < 8) v = 8;
        state.chart.setViewSize(v);
      };
      els.viewSizeInput.addEventListener('change', applyViewSize);
      els.viewSizeInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyViewSize();
          els.viewSizeInput.blur();
        }
      });
      els.viewSizeInput.addEventListener('focus', function () {
        els.viewSizeInput.select();
      });
    }

    els.showAvg.addEventListener('change', refreshChartOnly);
    els.dpPrice.addEventListener('input', refreshChartOnly);
    els.dpAmount.addEventListener('input', refreshChartOnly);
    els.dpVolume.addEventListener('input', refreshChartOnly);
    els.volUnit.addEventListener('change', refreshChartOnly);

    els.fsMinus.addEventListener('click', function () { adjFs(-1); });
    els.fsPlus.addEventListener('click', function () { adjFs(1); });

    // 标注模式开关
    els.annotMode.addEventListener('change', function () {
      state.annotationMode = els.annotMode.checked;
      // 切到详情模式（关）时若有标注浮窗已开则保留；切到标注模式（开）时关掉浮窗以免误操作
      if (state.annotationMode && state.intraday.open) {
        closeIntraday();
      }
    });

    // 分时浮窗关闭
    els.ipClose.addEventListener('click', closeIntraday);

    // 分时浮窗 header 拖拽
    bindIntradayDrag();

    window.addEventListener('resize', function () {
      if (state.chart) state.chart.draw();
      if (state.intraday.open && state.intraday.chart) state.intraday.chart.draw();
      renderMarkerGrid();
    });

    bindCalcHandlers();

    // 顶部「切换股票」下拉
    if (els.mobileStockBtn) {
      els.mobileStockBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleMobileStockMenu();
      });
    }
    if (els.mobileStockMenu) {
      els.mobileStockMenu.addEventListener('click', function (e) {
        var t = e.target.closest('.menu-item');
        if (!t) return;
        var id = +t.getAttribute('data-id');
        toggleMobileStockMenu(false);
        switchStock(id);
      });
    }
    document.addEventListener('click', function (e) {
      if (!els.mobileStockMenu || els.mobileStockMenu.hasAttribute('hidden')) return;
      if (els.mobileStockSwitcher && !els.mobileStockSwitcher.contains(e.target)) {
        toggleMobileStockMenu(false);
      }
    });
  }

  function checkConfig() {
    var cfg = window.YCCT_CONFIG && window.YCCT_CONFIG.zion;
    if (!cfg) return false;
    var keys = ['createStock', 'listStocks', 'deleteStock',
                'listKline', 'saveMarkers', 'getMarkers',
                'saveCalc', 'listCalcs', 'deleteCalc'];
    for (var i = 0; i < keys.length; i++) {
      if (!cfg[keys[i]]) return false;
    }
    return true;
  }

  // 旧的右上角 Zion 状态徽标已移除；保留空函数以兼容调用点
  function setZionStatus() { /* noop */ }

  function loadDemoMode() {
    state.isDemo = true;
    setZionStatus('demo', '演示模式');
    fetch('_demo_kline.json').then(function (r) { return r.json(); }).then(function (d) {
      state.stocks = [{
        id: 1, name: d.name, code: d.code,
        created_at: new Date().toISOString()
      }];
      state.activeStockId = 1;
      var rows = d.rows;
      var closes = rows.map(function (r) { return r.close; });
      state.klineData = {
        name: d.name, code: d.code,
        dates: rows.map(function (r) { return r.date; }),
        open: rows.map(function (r) { return r.open; }),
        high: rows.map(function (r) { return r.high; }),
        low: rows.map(function (r) { return r.low; }),
        close: closes,
        volume: rows.map(function (r) { return r.volume; }),
        amount: rows.map(function (r) { return r.amount; }),
        change: YcctChartUtils.computeChangePct(closes)
      };
      // 预置几个 markers 演示
      state.markers = [0, 7, 14, 21, 30, 45, 60, rows.length - 1].filter(function (i) { return i < rows.length; });
      renderStockList();
      renderChart();
      renderMarkerTags();
      renderIntervalTable();
      renderCalcTables();
      showStatus('演示模式：使用本地样本数据 ' + rows.length + ' 个交易日');
    }).catch(function (e) {
      els.chartWrap.innerHTML = '<div class="empty-chart" style="color:#c62828">' +
        '加载演示数据失败：' + e.message + '</div>';
    });
  }

  function init() {
    bindElements();
    bindHandlers();
    loadLocal();

    var isDemoMode = /[?&]demo=1\b/.test(location.search);
    if (isDemoMode) {
      loadDemoMode();
      return;
    }

    if (!checkConfig()) {
      setZionStatus('err', 'Zion 未配置');
      els.chartWrap.innerHTML = '<div class="empty-chart">' +
        '<div style="display:inline-flex;align-items:center;gap:8px;color:var(--warn);font-weight:600;font-size:14px;margin-bottom:10px">' +
        '<svg style="width:16px;height:16px" viewBox="0 0 16 16"><path d="M8 1.5l7 12.5H1L8 1.5zM8 6.5v3.5M8 12v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>' +
        'Zion webhook 未配置</div>' +
        '<div style="line-height:2;color:var(--text-3);font-size:12px">' +
        '请按 <code>Zion 行为流-YCCT.md</code> 在 Zion 创建表和行为流，<br>' +
        '然后把每个行为流的 webhook URL 填到 <code>config.js</code> 中。<br><br>' +
        '想先看效果？打开 <a href="?demo=1">演示模式</a>' +
        '</div></div>';
      return;
    }

    Zion.ping().then(function (r) {
      if (r.ok) {
        setZionStatus('ok', 'Zion 已连接');
      } else {
        setZionStatus('err', r.msg);
      }
    });

    loadStocks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
