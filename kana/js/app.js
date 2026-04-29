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
      // 日 K 草稿：{type:'volume'|'amount', cells:[{date, col, value}]}
      dailyDraft: null,
      // 分时草稿：{type, kline_id, cells:[{date, time, col, value}]}
      intradayDraft: null,
      // 已保存（来自 Zion）
      // daily 项：{id, calc_name, calc_type, calc_value, source:[{date,col,value}]}
      // intraday 项：上面 + intraday_kline_id
      daily: [],
      intraday: [],
      // 草稿浮框：跟踪当前活跃的草稿和锚点位置
      float: { scope: null, anchorRect: null }
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
      calcDraftKeys: getDailyDraftKeys(),
      calcSavedKeys: getDailySavedKeys(),
      onView: updateViewInfo
    }, initOpts));
    state.chart.draw();
    updateViewInfo(state.chart.getViewInfo());
    bindPagerHandlers();
    renderIntervalTable();
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

    // 同步 +/- 按钮可用性
    if (els.btnZoomIn) els.btnZoomIn.disabled = visN <= 8;
    if (els.btnZoomOut) els.btnZoomOut.disabled = visN >= info.total;

    // 缓存当前股票的视窗偏好（按股票分别记忆）
    if (state.activeStockId != null) {
      state.viewByStock[state.activeStockId] = { start: info.start, end: info.end };
    }
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
    if (state.calc.intradayDraft) {
      state.calc.intradayDraft = null;
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
      });
    });
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
  }

  function clearMarkers() {
    state.markers = [];
    if (state.chart) state.chart.update({ markers: [] });
    renderMarkerTags();
    renderIntervalTable();
  }

  function selectAllMarkers() {
    if (!state.klineData) return;
    state.markers = state.klineData.dates.map(function (_, i) { return i; });
    if (state.chart) state.chart.update({ markers: state.markers });
    renderMarkerTags();
    renderIntervalTable();
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
    state.calc.dailyDraft = null;
    state.calc.intradayDraft = null;
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
  }

  function addToDailyDraft(hit) {
    var d = state.calc.dailyDraft;
    if (!d) {
      d = state.calc.dailyDraft = { type: hit.col, cells: [] };
    }
    if (d.type !== hit.col) {
      toast('一列只能加同一类（' + (d.type === 'volume' ? '成交量' : '成交额') + '）');
      return;
    }
    var existIdx = -1;
    for (var i = 0; i < d.cells.length; i++) {
      if (d.cells[i].date === hit.date && d.cells[i].col === hit.col) { existIdx = i; break; }
    }
    if (existIdx >= 0) {
      d.cells.splice(existIdx, 1);
      if (d.cells.length === 0) state.calc.dailyDraft = null;
    } else {
      d.cells.push({ date: hit.date, col: hit.col, value: Number(hit.value) });
      d.cells.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    }
    refreshDailyChartCalcKeys();
    if (state.calc.dailyDraft) {
      // 草稿还在，浮框跟到最新双击的格子上方
      showCalcFloat('daily', hit.screen);
    } else {
      hideCalcFloat();
    }
    renderCalcTables();
  }

  function cancelDailyDraft() {
    state.calc.dailyDraft = null;
    refreshDailyChartCalcKeys();
    hideCalcFloat();
    renderCalcTables();
  }

  function doSaveDailyCalc(name) {
    var d = state.calc.dailyDraft;
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
      state.calc.dailyDraft = null;
      refreshDailyChartCalcKeys();
      hideCalcFloat();
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
  }

  function addToIntradayDraft(hit) {
    var klineId = getCurrentKlineId();
    if (!klineId) return toast('未取到当前分时的 kline_id');
    var dayIdx = state.intraday.dayIdx;
    var date = state.klineData.dates[dayIdx];

    var d = state.calc.intradayDraft;
    // 如果之前的草稿绑定到别的天（用户切换了分时浮窗），自动丢弃旧草稿重开
    if (d && d.kline_id !== klineId) d = state.calc.intradayDraft = null;
    if (!d) {
      d = state.calc.intradayDraft = { type: hit.col, kline_id: klineId, date: date, cells: [] };
    }
    if (d.type !== hit.col) {
      toast('一列只能加同一类（' + (d.type === 'volume' ? '交易量' : '交易额') + '）');
      return;
    }
    var existIdx = -1;
    for (var i = 0; i < d.cells.length; i++) {
      if (d.cells[i].time === hit.time && d.cells[i].col === hit.col) { existIdx = i; break; }
    }
    if (existIdx >= 0) {
      d.cells.splice(existIdx, 1);
      if (d.cells.length === 0) state.calc.intradayDraft = null;
    } else {
      d.cells.push({ date: date, time: hit.time, col: hit.col, value: Number(hit.value) });
      d.cells.sort(function (a, b) { return a.time < b.time ? -1 : 1; });
    }
    refreshIntradayChartCalcKeys();
    if (state.calc.intradayDraft) {
      showCalcFloat('intraday', hit.screen);
    } else {
      hideCalcFloat();
    }
    renderCalcTables();
  }

  function cancelIntradayDraft() {
    state.calc.intradayDraft = null;
    refreshIntradayChartCalcKeys();
    hideCalcFloat();
    renderCalcTables();
  }

  function doSaveIntradayCalc(name) {
    var d = state.calc.intradayDraft;
    if (!d || d.cells.length === 0) return;
    if (!state.activeStockId) return toast('请先选择股票');
    var sum = d.cells.reduce(function (s, c) { return s + (Number(c.value) || 0); }, 0);
    var payload = {
      calc_name: (name || '').trim() || '未命名',
      calc_type: d.type,
      calc_value: sum,
      source: d.cells.slice(),
      scope: 'intraday',
      intraday_kline_id: d.kline_id
    };
    Zion.saveCalc(state.activeStockId, payload).then(function (id) {
      var rec = Object.assign({}, payload, { id: Number(id) });
      state.calc.intraday.push(rec);
      state.calc.intradayDraft = null;
      refreshIntradayChartCalcKeys();
      hideCalcFloat();
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
    var d = state.calc.dailyDraft;
    if (d) for (var i = 0; i < d.cells.length; i++) s.add(d.cells[i].date + '|' + d.cells[i].col);
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
    var d = state.calc.intradayDraft;
    var klineId = getCurrentKlineId();
    if (d && d.kline_id === klineId) {
      for (var i = 0; i < d.cells.length; i++) s.add(d.cells[i].time + '|' + d.cells[i].col);
    }
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
    var saved = state.calc.intraday;

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
      tr2 += '<td>' + fmtCalcValueNumOnly(c.calc_value, c.calc_type) + '</td>';
      tr3 += '<td>' + shortDate(srcDate) + '</td>';
      tr4 += '<td>' + timeRangeStr(c.source) + '</td>';
    }
    tr1 += '</tr>'; tr2 += '</tr>'; tr3 += '</tr>'; tr4 += '</tr>';
    els.calcIntradayTable.innerHTML = buildColgroup(saved.length) + '<tbody>' + tr1 + tr2 + tr3 + tr4 + '</tbody>';
  }

  // ============== 草稿浮框 ==============
  function showCalcFloat(scope, anchorRect) {
    var draft = scope === 'daily' ? state.calc.dailyDraft : state.calc.intradayDraft;
    if (!draft || draft.cells.length === 0) {
      hideCalcFloat();
      return;
    }
    state.calc.float.scope = scope;
    state.calc.float.anchorRect = anchorRect || state.calc.float.anchorRect;

    // 内容
    var sum = draft.cells.reduce(function (s, c) { return s + (Number(c.value) || 0); }, 0);
    var typeName;
    if (scope === 'daily') {
      typeName = draft.type === 'volume' ? '成交量' : '成交额';
    } else {
      typeName = draft.type === 'volume' ? '交易量' : '交易额';
    }
    els.cfTag.textContent = typeName;
    els.cfTag.className = 'cf-tag t-' + draft.type;
    els.cfCount.textContent = draft.cells.length + ' 笔';
    els.cfValue.textContent = fmtCalcValue(sum, draft.type);

    els.calcFloat.style.display = '';
    positionCalcFloat();
  }

  function hideCalcFloat() {
    state.calc.float.scope = null;
    state.calc.float.anchorRect = null;
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
  function openCalcModal() {
    var scope = state.calc.float.scope;
    if (!scope) return;
    var draft = scope === 'daily' ? state.calc.dailyDraft : state.calc.intradayDraft;
    if (!draft || draft.cells.length === 0) return;

    var sum = draft.cells.reduce(function (s, c) { return s + (Number(c.value) || 0); }, 0);
    var typeName;
    if (scope === 'daily') {
      typeName = draft.type === 'volume' ? '成交量' : '成交额';
    } else {
      typeName = draft.type === 'volume' ? '交易量' : '交易额';
    }
    var rangeText;
    if (scope === 'daily') {
      rangeText = '日期范围：' + dateRangeStr(draft.cells);
    } else {
      rangeText = shortDate(draft.date) + '  ' + timeRangeStr(draft.cells);
    }
    els.calcModalSummary.innerHTML =
      '<div>类型：' + typeName + ' · ' + draft.cells.length + ' 笔</div>' +
      '<div style="margin-top:4px">累加结果：<b>' + fmtCalcValue(sum, draft.type) + '</b></div>' +
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
    closeCalcModal();
    if (scope === 'daily') doSaveDailyCalc(name);
    else if (scope === 'intraday') doSaveIntradayCalc(name);
  }

  // 计算面板内的 click 委托（仅删除已保存项）+ 浮框 / modal 按钮
  function bindCalcHandlers() {
    if (!els.calcSec) return;

    els.calcMode.addEventListener('change', function () {
      state.calc.mode = els.calcMode.checked;
      // 关闭时丢弃所有未保存草稿
      if (!state.calc.mode) {
        state.calc.dailyDraft = null;
        state.calc.intradayDraft = null;
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

    // 草稿浮框按钮
    els.cfSave.addEventListener('click', openCalcModal);
    els.cfCancel.addEventListener('click', function () {
      var scope = state.calc.float.scope;
      if (scope === 'daily') cancelDailyDraft();
      else if (scope === 'intraday') cancelIntradayDraft();
      else hideCalcFloat();
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
    els.intervalSec = document.getElementById('intervalSec');
    els.markerTags = document.getElementById('markerTags');
    els.status = document.getElementById('status');

    els.btnClear = document.getElementById('btnClear');
    els.btnSelectAll = document.getElementById('btnSelectAll');
    els.btnSave = document.getElementById('btnSave');
    els.btnZoomIn = document.getElementById('btnZoomIn');     // -（少看 1 天）
    els.btnZoomOut = document.getElementById('btnZoomOut');   // +（多看 1 天）
    els.viewSizeInput = document.getElementById('viewSizeInput');

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
    els.cfTag = document.getElementById('cfTag');
    els.cfCount = document.getElementById('cfCount');
    els.cfValue = document.getElementById('cfValue');
    els.cfSave = document.getElementById('cfSave');
    els.cfCancel = document.getElementById('cfCancel');

    // 保存计算 modal
    els.calcModalMask = document.getElementById('calcModalMask');
    els.calcModalSummary = document.getElementById('calcModalSummary');
    els.calcModalTitle = document.getElementById('calcModalTitle');
    els.calcModalCancel = document.getElementById('calcModalCancel');
    els.calcModalSubmit = document.getElementById('calcModalSubmit');
  }

  function bindHandlers() {
    els.btnAddStock.addEventListener('click', openCreateStockModal);
    els.btnSubmit.addEventListener('click', submitCreateStock);
    els.btnCancel.addEventListener('click', closeModal);
    els.modalMask.addEventListener('click', function (e) {
      if (e.target === els.modalMask) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      // ESC：保存计算 modal > 新建股票 modal > 草稿浮框 > 分时浮窗
      if (e.key === 'Escape') {
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
