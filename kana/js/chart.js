// =============================================================
// YCCT K 线图 + 标注 + 底部数据表
// 单 Canvas 实现：上方 K 线 + 下方两段数据表
// 双击插入/删除标注线，鼠标移动预览
// 滚轮缩放（以鼠标位置为锚点）+ 拖拽平移
// =============================================================
(function (global) {

  var UNIT_LABELS = {
    100: '百', 1000: '千', 10000: '万', 100000: '十万',
    1000000: '百万', 10000000: '千万',
    100000000: '亿', 1000000000: '十亿'
  };

  var COLOR_UP = '#ef4444';
  var COLOR_DOWN = '#22c55e';
  var COLOR_FLAT = '#6b7280';
  var COLOR_TEXT = '#111827';
  var COLOR_TEXT_2 = '#374151';
  var COLOR_TEXT_3 = '#9ca3af';
  var COLOR_GRID = '#f3f4f6';
  var COLOR_MARKER = '#ea580c';
  var COLOR_CALC = '#dc2626';   // 被选中加入「计算」的格子文字颜色

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   *   data: {name, code, dates[], open[], high[], low[], close[], volume[], amount[], change[]}
   *   markers: number[] (index 数组)
   *   showAverages: boolean
   *   dpPrice, dpAmount, dpVolume: int
   *   volUnit: int
   *   fontSize: int
   *   onDblclick(idx)  双击回调
   *   onHover(idx|-1)
   */
  function YcctChart(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts || {};
    this.hoverIdx = -1;

    var n = (opts.data && opts.data.dates) ? opts.data.dates.length : 0;
    // 初始视窗：默认显示最后 initialViewSize 天（如未提供则全部）
    var defaultSize = opts.initialViewSize ? Math.min(opts.initialViewSize, n) : n;
    this.viewEnd = Math.max(0, n - 1);
    this.viewStart = Math.max(0, this.viewEnd - defaultSize + 1);

    // 允许外部初始指定 viewStart / viewEnd（用于切股票时保留偏好）
    if (typeof opts.initialViewStart === 'number' && typeof opts.initialViewEnd === 'number') {
      this.viewStart = Math.max(0, Math.min(n - 1, opts.initialViewStart));
      this.viewEnd = Math.max(this.viewStart, Math.min(n - 1, opts.initialViewEnd));
    }

    this._bindEvents();
  }

  YcctChart.prototype.update = function (patch) {
    var dataChanged = patch && patch.data && patch.data !== this.opts.data;
    Object.assign(this.opts, patch);
    if (dataChanged) {
      var n = this.opts.data.dates.length;
      var size = this.opts.initialViewSize ? Math.min(this.opts.initialViewSize, n) : n;
      this.viewEnd = Math.max(0, n - 1);
      this.viewStart = Math.max(0, this.viewEnd - size + 1);
    }
    this.draw();
  };

  // 缩放：增大视窗数量 delta 天（delta 可负为缩小）。锚点固定在视窗右端。
  YcctChart.prototype.zoomBy = function (delta) {
    if (!this.opts.data) return;
    var n = this.opts.data.dates.length;
    var size = this.viewEnd - this.viewStart + 1;
    var newSize = Math.max(8, Math.min(n, size + delta));
    if (newSize === size) return;
    // 以右端为锚扩展/收缩
    this.viewStart = Math.max(0, this.viewEnd - newSize + 1);
    if (this.viewStart === 0) this.viewEnd = Math.min(n - 1, this.viewStart + newSize - 1);
    this.draw();
    if (this.opts.onView) this.opts.onView(this.getViewInfo());
  };

  // 直接设定视窗天数（输入框场景）。clamp 到 [8, total]
  YcctChart.prototype.setViewSize = function (size) {
    if (!this.opts.data) return;
    var n = this.opts.data.dates.length;
    var cur = this.viewEnd - this.viewStart + 1;
    var newSize = Math.max(8, Math.min(n, Math.round(Number(size) || cur)));
    if (newSize === cur) return;
    this.viewStart = Math.max(0, this.viewEnd - newSize + 1);
    if (this.viewStart === 0) this.viewEnd = Math.min(n - 1, this.viewStart + newSize - 1);
    this.draw();
    if (this.opts.onView) this.opts.onView(this.getViewInfo());
  };

  // 平移：视窗整体向右移动 delta 天（delta 可负，向左为更早）
  YcctChart.prototype.panBy = function (delta) {
    if (!this.opts.data) return;
    var n = this.opts.data.dates.length;
    var size = this.viewEnd - this.viewStart + 1;
    var newStart = Math.max(0, Math.min(n - size, this.viewStart + delta));
    if (newStart === this.viewStart) return;
    this.viewStart = newStart;
    this.viewEnd = newStart + size - 1;
    this.draw();
    if (this.opts.onView) this.opts.onView(this.getViewInfo());
  };

  // 设置视窗（绝对位置）
  YcctChart.prototype.setView = function (start, end) {
    if (!this.opts.data) return;
    var n = this.opts.data.dates.length;
    this.viewStart = Math.max(0, Math.min(n - 1, start));
    this.viewEnd = Math.max(this.viewStart, Math.min(n - 1, end));
    this.draw();
    if (this.opts.onView) this.opts.onView(this.getViewInfo());
  };

  // 全部：显示所有数据
  YcctChart.prototype.viewAll = function () {
    if (!this.opts.data) return;
    this.viewStart = 0;
    this.viewEnd = Math.max(0, this.opts.data.dates.length - 1);
    this.draw();
    if (this.opts.onView) this.opts.onView(this.getViewInfo());
  };

  // 兼容旧名
  YcctChart.prototype.resetZoom = function () { this.viewAll(); };

  YcctChart.prototype.getViewInfo = function () {
    if (!this.opts.data) return null;
    return {
      start: this.viewStart,
      end: this.viewEnd,
      total: this.opts.data.dates.length,
      startDate: this.opts.data.dates[this.viewStart],
      endDate: this.opts.data.dates[this.viewEnd]
    };
  };

  YcctChart.prototype._bindEvents = function () {
    var self = this;
    var canvas = this.canvas;

    canvas.addEventListener('mouseleave', function () {
      self.hoverIdx = -1;
      self.draw();
      if (self.opts.onHover) self.opts.onHover(-1);
    });

    canvas.addEventListener('mousemove', function (e) {
      if (!self.opts.data) return;
      var rect = canvas.getBoundingClientRect();
      var px = e.clientX - rect.left;
      var py = e.clientY - rect.top;

      // 悬停检测（仅在 K 线区域内）
      if (py < self._chartTop || py > self._chartBottom) {
        if (self.hoverIdx !== -1) {
          self.hoverIdx = -1;
          self.draw();
          if (self.opts.onHover) self.opts.onHover(-1);
        }
        return;
      }
      var idx = self._idxAtX(px);
      if (idx !== self.hoverIdx) {
        self.hoverIdx = idx;
        self.draw();
        if (self.opts.onHover) self.opts.onHover(idx);
      }
    });

    // ---- 双击：先看是否命中标注表的量/额单元格 → onCellDblclick；否则 onDblclick ----
    canvas.addEventListener('dblclick', function (e) {
      var rect = canvas.getBoundingClientRect();
      var px = e.clientX - rect.left;
      var py = e.clientY - rect.top;
      var hit = self.getCellAt(px, py);
      if (hit) {
        // 把命中格子的屏幕坐标也带回去（用于浮框定位）
        hit.screen = {
          left: rect.left + hit.x,
          top: rect.top + hit.y,
          right: rect.left + hit.x + hit.w,
          bottom: rect.top + hit.y + hit.h
        };
        if (self.opts.onCellDblclick) self.opts.onCellDblclick(hit);
        return;
      }
      if (self.hoverIdx < 0) return;
      if (self.opts.onDblclick) self.opts.onDblclick(self.hoverIdx);
    });

    // ---- 右键删除最近的标注 ----
    canvas.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (self.hoverIdx < 0) return;
      var markers = self.opts.markers || [];
      if (markers.length === 0) return;
      var closest = 0;
      for (var i = 1; i < markers.length; i++) {
        if (Math.abs(markers[i] - self.hoverIdx) < Math.abs(markers[closest] - self.hoverIdx))
          closest = i;
      }
      if (self.opts.onDblclick) self.opts.onDblclick(markers[closest]);
    });
  };

  // 命中标注表里的量/额单元格（无命中时返回 null）
  YcctChart.prototype.getCellAt = function (px, py) {
    if (!this._cellHits) return null;
    for (var i = 0; i < this._cellHits.length; i++) {
      var h = this._cellHits[i];
      if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) return h;
    }
    return null;
  };

  YcctChart.prototype._idxAtX = function (px) {
    var viewN = this.viewEnd - this.viewStart + 1;
    var rel = (px - this._padLeft) / this._plotW;
    if (rel < 0 || rel > 1) return -1;
    var i = Math.floor(rel * viewN) + this.viewStart;
    return Math.max(this.viewStart, Math.min(this.viewEnd, i));
  };

  YcctChart.prototype._xOf = function (i) {
    var viewN = this.viewEnd - this.viewStart + 1;
    return this._padLeft + this._plotW * (i - this.viewStart + 0.5) / viewN;
  };

  YcctChart.prototype._yOfPrice = function (p) {
    return this._chartTop + this._plotH * (1 - (p - this._priceLo) / (this._priceHi - this._priceLo));
  };

  YcctChart.prototype._isInView = function (i) {
    return i >= this.viewStart && i <= this.viewEnd;
  };

  YcctChart.prototype._layout = function () {
    var data = this.opts.data;
    if (!data) return;
    var fs = Math.max(2, Math.min(14, this.opts.fontSize || 12));
    this._fs = fs;

    // 容器宽度（适应父容器，不再横向滚动）
    var parent = this.canvas.parentElement;
    var containerW = parent ? parent.clientWidth : 1100;
    var isMobile = containerW <= 768;
    this._isMobile = isMobile;
    this._W = isMobile
      ? Math.max(320, containerW - 4)   // 手机：跟容器走，保证 100% 宽
      : Math.max(800, containerW - 4);   // 桌面：保最小 800
    this._padLeft = isMobile ? 44 : 80;
    this._padRight = isMobile ? 12 : 30;
    this._padTop = 38;
    this._plotW = this._W - this._padLeft - this._padRight;
    // 手机端：canvas 不画底部标注表（由 HTML 网格替代）
    this._hideMarkerTable = isMobile || !!this.opts.hideMarkerTable;

    // 行高、表格区
    this._rowH = Math.max(14, fs + 6);
    var hasMarkers = (this.opts.markers && this.opts.markers.length > 0);
    var hasAvg = hasMarkers && this.opts.showAverages && this.opts.markers.length >= 2;
    var hasAmount = data.amount && data.amount.some(function (v) { return v != null; });
    var hasVolume = data.volume && data.volume.some(function (v) { return v != null; });
    this._hasAmount = hasAmount;
    this._hasVolume = hasVolume;
    this._hasChange = data.change && data.change.length > 0;

    // 行：日期 + 涨跌幅 + 价格 + (额) + (量)
    var sec1Rows = 1 + (this._hasChange ? 1 : 0) + 1 + (hasAmount ? 1 : 0) + (hasVolume ? 1 : 0);
    var sec2Rows = hasAvg ? sec1Rows : 0;

    this._sec1H = (hasMarkers && !this._hideMarkerTable) ? sec1Rows * this._rowH + 8 : 0;
    this._sec2H = (hasAvg && !this._hideMarkerTable) ? sec2Rows * this._rowH + 16 : 0;

    this._chartTop = this._padTop;
    this._plotH = this._isMobile ? 320 : 460;
    this._chartBottom = this._chartTop + this._plotH;

    this._sec1Top = this._chartBottom + 24;
    this._sec2Top = this._sec1Top + this._sec1H;

    var totalH = this._sec2Top + this._sec2H + 24;
    this._H = Math.max(this._isMobile ? 380 : 560, totalH);

    // 物理像素
    var dpr = global.devicePixelRatio || 1;
    this.canvas.style.width = this._W + 'px';
    this.canvas.style.height = this._H + 'px';
    this.canvas.width = this._W * dpr;
    this.canvas.height = this._H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 价格区间 = 仅可视范围
    var lo = Infinity, hi = -Infinity;
    for (var i = this.viewStart; i <= this.viewEnd; i++) {
      if (data.low[i] < lo) lo = data.low[i];
      if (data.high[i] > hi) hi = data.high[i];
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    var pad = (hi - lo) * 0.08 || 1;
    this._priceLo = lo - pad;
    this._priceHi = hi + pad;
  };

  YcctChart.prototype.draw = function () {
    if (!this.opts.data) return;
    this._layout();
    var ctx = this.ctx;
    var data = this.opts.data;
    var W = this._W, H = this._H;
    var viewN = this.viewEnd - this.viewStart + 1;

    // 背景
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // 标题
    ctx.fillStyle = COLOR_TEXT;
    ctx.font = '600 14px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      (data.name || '') + ' (' + (data.code || '') + ') 日K线标注分析',
      W / 2, 22
    );

    // Y 轴价格刻度
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;
    ctx.fillStyle = COLOR_TEXT_3;
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    for (var gi = 0; gi <= 5; gi++) {
      var y = this._chartTop + this._plotH * gi / 5;
      ctx.beginPath();
      ctx.moveTo(this._padLeft, y);
      ctx.lineTo(this._padLeft + this._plotW, y);
      ctx.stroke();
      var p = this._priceHi - (this._priceHi - this._priceLo) * gi / 5;
      ctx.fillText(p.toFixed(1), this._padLeft - 6, y + 3);
    }

    // 标记线（只画 view 内的）
    var markers = this.opts.markers || [];
    var markersSorted = markers.slice().sort(function (a, b) { return a - b; });
    ctx.strokeStyle = COLOR_MARKER;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    for (var mi = 0; mi < markersSorted.length; mi++) {
      var idxM = markersSorted[mi];
      if (!this._isInView(idxM)) continue;
      var xM = this._xOf(idxM);
      ctx.beginPath();
      ctx.moveTo(xM, this._chartTop);
      ctx.lineTo(xM, this._chartBottom);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // 蜡烛（只画 view 内的）
    var bw = Math.max(2, Math.min(28, this._plotW / viewN * 0.7));
    for (var i = this.viewStart; i <= this.viewEnd; i++) {
      var x2 = this._xOf(i);
      var o = data.open[i], h = data.high[i], l = data.low[i], c = data.close[i];
      var up = c >= o;
      var color = up ? COLOR_UP : COLOR_DOWN;
      var yH = this._yOfPrice(h), yL = this._yOfPrice(l);
      var yO = this._yOfPrice(o), yC = this._yOfPrice(c);
      var bTop = Math.min(yO, yC);
      var bBot = Math.max(yO, yC);
      var bH = Math.max(bBot - bTop, 1);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x2, yH); ctx.lineTo(x2, bTop); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, bBot); ctx.lineTo(x2, yL); ctx.stroke();

      if (up) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(x2 - bw / 2, bTop, bw, bH);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(x2 - bw / 2, bTop, bw, bH);
      }
    }

    // X 轴标签（只显示 view 内）
    var step = Math.max(1, Math.floor(viewN / 16));
    ctx.fillStyle = COLOR_TEXT_3;
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    for (var xi = this.viewStart; xi <= this.viewEnd; xi += step) {
      var xL = this._xOf(xi);
      ctx.fillText(data.dates[xi].slice(5), xL, this._chartBottom + 14);
    }
    if ((this.viewEnd - this.viewStart) % step !== 0) {
      ctx.fillText(data.dates[this.viewEnd].slice(5), this._xOf(this.viewEnd), this._chartBottom + 14);
    }

    // hover
    if (this._isInView(this.hoverIdx)) {
      var hx = this._xOf(this.hoverIdx);
      ctx.strokeStyle = 'rgba(17,24,39,0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, this._chartTop);
      ctx.lineTo(hx, this._chartBottom);
      ctx.stroke();
      ctx.setLineDash([]);
      var lblText = data.dates[this.hoverIdx].slice(5) + '   ' + data.close[this.hoverIdx].toFixed(2);
      ctx.font = '11px -apple-system, sans-serif';
      var tw = ctx.measureText(lblText).width + 14;
      var lx = hx - tw / 2;
      if (lx < this._padLeft) lx = this._padLeft;
      if (lx + tw > W - this._padRight) lx = W - this._padRight - tw;
      ctx.fillStyle = COLOR_TEXT;
      ctx.fillRect(lx, this._chartTop - 22, tw, 18);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(lblText, lx + tw / 2, this._chartTop - 9);
    }

    // ---- 底部数据表（只显示 view 内的 marker） ----
    var visMarkers = markersSorted.filter(this._isInView, this);
    if (visMarkers.length > 0 && !this._hideMarkerTable) {
      this._drawMarkerTable(visMarkers);
    }
    // 平均区间表（只画两端都在 view 内的区间）
    if (visMarkers.length >= 2 && this.opts.showAverages && !this._hideMarkerTable) {
      this._drawAverageTable(visMarkers);
    }
  };

  function fmtNum(v, dp) {
    if (v == null || !isFinite(v)) return '-';
    return v.toFixed(dp);
  }

  function fmtPct(v) {
    if (v == null || !isFinite(v)) return '-';
    var s = v >= 0 ? '+' : '';
    return s + v.toFixed(2) + '%';
  }

  function pctColor(v) {
    if (v == null || !isFinite(v) || v === 0) return COLOR_FLAT;
    return v > 0 ? COLOR_UP : COLOR_DOWN;
  }

  YcctChart.prototype._drawMarkerTable = function (markers) {
    var ctx = this.ctx;
    var data = this.opts.data;
    var fs = this._fs;
    var rowH = this._rowH;
    var dpP = this.opts.dpPrice || 0;
    var dpA = this.opts.dpAmount || 0;
    var dpV = this.opts.dpVolume || 0;
    var volUnit = this.opts.volUnit || 100000000;
    var volLabel = '成交量(' + (UNIT_LABELS[volUnit] || ('×' + volUnit)) + ')';

    // 行序：日期 / 涨跌幅 / 价格 / 成交额 / 成交量
    var rowIdxDate = 0;
    var rowIdxChange = this._hasChange ? 1 : -1;
    var rowIdxPrice = this._hasChange ? 2 : 1;
    var rowIdxAmount = -1, rowIdxVolume = -1;
    var nextRow = rowIdxPrice + 1;
    if (this._hasAmount) { rowIdxAmount = nextRow++; }
    if (this._hasVolume) { rowIdxVolume = nextRow++; }

    var top = this._sec1Top;
    var labelX = this._padLeft - 10;

    // 重置点击命中区（下面 drawCol 会按 marker 列填充）
    this._cellHits = [];

    // 计算高亮键集合：被加进草稿或已保存的格子，文字会染红
    var _calcDraftSet = this.opts.calcDraftKeys || null;
    var _calcSavedSet = this.opts.calcSavedKeys || null;

    // ===== 左侧标签列 =====
    ctx.font = '600 ' + fs + 'px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = COLOR_TEXT_3;
    ctx.fillText('日期', labelX, top + rowIdxDate * rowH + fs);
    if (rowIdxChange >= 0) {
      ctx.fillStyle = COLOR_TEXT_2;
      ctx.fillText('涨跌幅', labelX, top + rowIdxChange * rowH + fs);
    }
    ctx.fillStyle = COLOR_TEXT_2;
    ctx.fillText('价格', labelX, top + rowIdxPrice * rowH + fs);
    if (rowIdxAmount >= 0) {
      ctx.fillText('成交额(亿)', labelX, top + rowIdxAmount * rowH + fs);
    }
    if (rowIdxVolume >= 0) {
      ctx.fillText(volLabel, labelX, top + rowIdxVolume * rowH + fs);
    }

    // ===== 计算每个 marker 列的 (x, ha) =====
    var closeThresh = (this._plotW / (this.viewEnd - this.viewStart + 1)) * 4;
    var cols = [];
    for (var mi = 0; mi < markers.length; mi++) {
      var idxC = markers[mi];
      var xC = this._xOf(idxC);
      var ha = 'center';
      var prev = mi > 0 ? this._xOf(markers[mi - 1]) : -Infinity;
      var next = mi < markers.length - 1 ? this._xOf(markers[mi + 1]) : Infinity;
      var prevClose = (xC - prev) < closeThresh;
      var nextClose = (next - xC) < closeThresh;
      if (prevClose && !nextClose) { ha = 'left'; xC += 2; }
      else if (nextClose && !prevClose) { ha = 'right'; xC -= 2; }
      cols.push({ idx: idxC, x: xC, ha: ha });
    }

    // ===== 找到 hover 命中的 marker 列 =====
    var hoverCol = -1;
    if (this._isInView(this.hoverIdx)) {
      var hx = this._xOf(this.hoverIdx);
      var bestDist = Infinity, bestI = -1;
      for (var c = 0; c < cols.length; c++) {
        var d = Math.abs(this._xOf(cols[c].idx) - hx);
        if (d < bestDist) { bestDist = d; bestI = c; }
      }
      var th = Math.max(30, this._plotW / Math.max(1, this.viewEnd - this.viewStart + 1) * 4);
      if (bestI >= 0 && bestDist <= th) hoverCol = bestI;
    }

    var self = this;
    function drawCol(ci) {
      var col = cols[ci];
      var idx = col.idx;
      var dStr = data.dates[idx].slice(5).replace('-', '');
      var price = data.close[idx];
      var amt = self._hasAmount ? data.amount[idx] : null;
      var vol = self._hasVolume ? data.volume[idx] : null;
      var change = (self._hasChange && data.change) ? data.change[idx] : null;
      ctx.textAlign = col.ha;

      ctx.font = '600 ' + (fs - 2) + 'px -apple-system, "PingFang SC", sans-serif';
      ctx.fillStyle = COLOR_MARKER;
      ctx.fillText(dStr, col.x, top + rowIdxDate * rowH + fs);

      if (rowIdxChange >= 0) {
        ctx.font = '600 ' + (fs - 1) + 'px -apple-system, sans-serif';
        ctx.fillStyle = pctColor(change);
        ctx.fillText(fmtPct(change), col.x, top + rowIdxChange * rowH + fs);
      }

      ctx.font = '600 ' + fs + 'px -apple-system, "PingFang SC", sans-serif';
      ctx.fillStyle = COLOR_TEXT;
      ctx.fillText(fmtNum(price, dpP), col.x, top + rowIdxPrice * rowH + fs);

      if (rowIdxAmount >= 0) {
        var amtYi = amt == null ? null : amt / 1e8;
        var amtKey = data.dates[idx] + '|amount';
        var amtSelected = (_calcDraftSet && _calcDraftSet.has(amtKey)) ||
                          (_calcSavedSet && _calcSavedSet.has(amtKey));
        ctx.fillStyle = amtSelected ? COLOR_CALC : COLOR_TEXT;
        ctx.fillText(fmtNum(amtYi, dpA), col.x, top + rowIdxAmount * rowH + fs);
      }
      if (rowIdxVolume >= 0) {
        var volC = vol == null ? null : vol / volUnit;
        var volKey = data.dates[idx] + '|volume';
        var volSelected = (_calcDraftSet && _calcDraftSet.has(volKey)) ||
                          (_calcSavedSet && _calcSavedSet.has(volKey));
        ctx.fillStyle = volSelected ? COLOR_CALC : COLOR_TEXT;
        ctx.fillText(fmtNum(volC, dpV), col.x, top + rowIdxVolume * rowH + fs);
      }

      // 记录可点击的量/额单元格（外层捕获 dblclick 时用 getCellAt 命中）
      var halfW = 36;
      if (rowIdxAmount >= 0 && amt != null) {
        self._cellHits.push({
          idx: idx, date: data.dates[idx], col: 'amount', value: amt,
          key: data.dates[idx] + '|amount',
          x: col.x - halfW, y: top + rowIdxAmount * rowH - 1,
          w: halfW * 2, h: rowH + 1
        });
      }
      if (rowIdxVolume >= 0 && vol != null) {
        self._cellHits.push({
          idx: idx, date: data.dates[idx], col: 'volume', value: vol,
          key: data.dates[idx] + '|volume',
          x: col.x - halfW, y: top + rowIdxVolume * rowH - 1,
          w: halfW * 2, h: rowH + 1
        });
      }
    }

    // 阶段 1：先画所有 marker 列（量/额格子若被选入计算会自动染红）
    for (var i = 0; i < cols.length; i++) drawCol(i);

    // 阶段 2：hover 高亮 → 白底矩形覆盖相邻 + 重画该列 + 橙色边框
    if (hoverCol >= 0) {
      var hCol = cols[hoverCol];
      var hIdx = hCol.idx;
      var dStrH = data.dates[hIdx].slice(5).replace('-', '');
      var amtH = this._hasAmount ? data.amount[hIdx] : null;
      var volH = this._hasVolume ? data.volume[hIdx] : null;
      var chgH = (this._hasChange && data.change) ? data.change[hIdx] : null;
      ctx.font = '600 ' + fs + 'px -apple-system, "PingFang SC", sans-serif';
      var widths = [
        ctx.measureText(dStrH).width,
        ctx.measureText(fmtNum(data.close[hIdx], dpP)).width,
        ctx.measureText(fmtPct(chgH)).width,
        amtH != null ? ctx.measureText(fmtNum(amtH / 1e8, dpA)).width : 0,
        volH != null ? ctx.measureText(fmtNum(volH / volUnit, dpV)).width : 0
      ];
      var maxW = 0;
      for (var w = 0; w < widths.length; w++) if (widths[w] > maxW) maxW = widths[w];
      var totalRows = 1 + (rowIdxChange >= 0 ? 1 : 0) + 1 +
                      (rowIdxAmount >= 0 ? 1 : 0) + (rowIdxVolume >= 0 ? 1 : 0);
      var pad = 8;
      var boxW = maxW + pad * 2;
      var boxH = totalRows * rowH + 6;
      var boxX;
      if (hCol.ha === 'left')       boxX = hCol.x - pad;
      else if (hCol.ha === 'right') boxX = hCol.x - boxW + pad;
      else                          boxX = hCol.x - boxW / 2;
      var boxY = top - 2;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeStyle = COLOR_MARKER;
      ctx.lineWidth = 1;
      ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

      drawCol(hoverCol);
    }
  };

  YcctChart.prototype._drawAverageTable = function (markers) {
    var ctx = this.ctx;
    var data = this.opts.data;
    var fs = this._fs;
    var rowH = this._rowH;
    var dpP = this.opts.dpPrice || 0;
    var dpA = this.opts.dpAmount || 0;
    var dpV = this.opts.dpVolume || 0;
    var volUnit = this.opts.volUnit || 100000000;
    var volLabel = '成交量(' + (UNIT_LABELS[volUnit] || ('×' + volUnit)) + ')';

    var rowIdxLabel = 0;
    var rowIdxChange = this._hasChange ? 1 : -1;
    var rowIdxPrice = this._hasChange ? 2 : 1;
    var rowIdxAmount = -1, rowIdxVolume = -1;
    var nextRow = rowIdxPrice + 1;
    if (this._hasAmount) { rowIdxAmount = nextRow++; }
    if (this._hasVolume) { rowIdxVolume = nextRow++; }

    var top = this._sec2Top;
    var labelX = this._padLeft - 10;

    // 左侧标签
    ctx.font = '600 ' + fs + 'px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = COLOR_TEXT_3;
    ctx.fillText('平均', labelX, top + rowIdxLabel * rowH + fs);
    if (rowIdxChange >= 0) {
      ctx.fillStyle = COLOR_TEXT_2;
      ctx.fillText('区间涨跌', labelX, top + rowIdxChange * rowH + fs);
    }
    ctx.fillStyle = COLOR_TEXT_2;
    ctx.fillText('价格', labelX, top + rowIdxPrice * rowH + fs);
    if (rowIdxAmount >= 0) {
      ctx.fillText('成交额(亿)', labelX, top + rowIdxAmount * rowH + fs);
    }
    if (rowIdxVolume >= 0) {
      ctx.fillText(volLabel, labelX, top + rowIdxVolume * rowH + fs);
    }

    ctx.textAlign = 'center';
    for (var k = 0; k < markers.length - 1; k++) {
      var s = markers[k], e = markers[k + 1];
      var midX = (this._xOf(s) + this._xOf(e)) / 2;

      var inner = e - s - 1;
      if (inner <= 0) continue;
      var sumP = 0, cntP = 0, sumA = 0, cntA = 0, sumV = 0, cntV = 0;
      for (var ii = s + 1; ii < e; ii++) {
        if (data.close[ii] != null) { sumP += data.close[ii]; cntP++; }
        if (this._hasAmount && data.amount[ii] != null) { sumA += data.amount[ii]; cntA++; }
        if (this._hasVolume && data.volume[ii] != null) { sumV += data.volume[ii]; cntV++; }
      }
      var avgP = cntP > 0 ? sumP / cntP : null;
      var avgA = cntA > 0 ? sumA / cntA : null;
      var avgV = cntV > 0 ? sumV / cntV : null;

      // 区间涨跌幅 = (end_close / start_close - 1) * 100
      var intervalPct = null;
      if (data.close[s] && data.close[e]) {
        intervalPct = (data.close[e] / data.close[s] - 1) * 100;
      }

      // 行 平均
      ctx.font = '600 ' + fs + 'px -apple-system, "PingFang SC", sans-serif';
      ctx.fillStyle = COLOR_TEXT_2;
      ctx.fillText('平均', midX, top + rowIdxLabel * rowH + fs);

      // 行 区间涨跌
      if (rowIdxChange >= 0) {
        ctx.font = '600 ' + (fs - 1) + 'px -apple-system, sans-serif';
        ctx.fillStyle = pctColor(intervalPct);
        ctx.fillText(fmtPct(intervalPct), midX, top + rowIdxChange * rowH + fs);
      }

      // 行 价格
      ctx.font = '600 ' + fs + 'px -apple-system, "PingFang SC", sans-serif';
      ctx.fillStyle = COLOR_TEXT;
      ctx.fillText(fmtNum(avgP, dpP), midX, top + rowIdxPrice * rowH + fs);

      if (rowIdxAmount >= 0) {
        var avgAYi = avgA == null ? null : avgA / 1e8;
        ctx.fillText(fmtNum(avgAYi, dpA), midX, top + rowIdxAmount * rowH + fs);
      }
      if (rowIdxVolume >= 0) {
        var avgVC = avgV == null ? null : avgV / volUnit;
        ctx.fillText(fmtNum(avgVC, dpV), midX, top + rowIdxVolume * rowH + fs);
      }
    }
  };

  /**
   * 计算区间数据（HTML 表格用）
   */
  function computeIntervals(data, markers) {
    if (markers.length < 2) return null;
    var sorted = markers.slice().sort(function (a, b) { return a - b; });
    var firstOpen = data.open[0];
    var out = [];
    for (var i = 0; i < sorted.length - 1; i++) {
      var s = sorted[i], e = sorted[i + 1];
      var sPrice = data.close[s];
      var ePrice = data.close[e];
      var pct = (ePrice / sPrice - 1) * 100;
      out.push({
        startDate: data.dates[s],
        startPrice: sPrice,
        startVsFirst: (sPrice / firstOpen - 1) * 100,
        endDate: data.dates[e],
        endPrice: ePrice,
        endVsFirst: (ePrice / firstOpen - 1) * 100,
        endVsStart: pct,
        days: e - s - 1,
        trend: pct > 0 ? '上涨' : (pct < 0 ? '下跌' : '横盘')
      });
    }
    return { firstOpen: firstOpen, intervals: out };
  }

  /**
   * 计算每日涨跌幅数组（vs 上一日 close）
   * @param {Array<number>} closes
   * @return {Array<number|null>}
   */
  function computeChangePct(closes) {
    if (!Array.isArray(closes) || closes.length === 0) return [];
    var out = [null];
    for (var i = 1; i < closes.length; i++) {
      if (closes[i - 1] && closes[i]) {
        out.push((closes[i] / closes[i - 1] - 1) * 100);
      } else {
        out.push(null);
      }
    }
    return out;
  }

  // =============================================================
  // IntradayChart  分时图（一天分钟级折线 + 标注）
  // 数据：ticks = [{t:"HH:MM", p, v, a, c?}, ...]
  // c 是相对昨收的涨跌幅（小数，如 0.006 表示 0.6%）；如果没有，则用 prevClose 计算
  // =============================================================
  function IntradayChart(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts || {};
    this.hoverIdx = -1;
    this._destroyed = false;
    this._listeners = [];
    this._bindEvents();
  }

  IntradayChart.prototype.update = function (patch) {
    Object.assign(this.opts, patch);
    this.draw();
  };

  IntradayChart.prototype._bindEvents = function () {
    var self = this;
    var canvas = this.canvas;
    function on(type, fn) {
      canvas.addEventListener(type, fn);
      self._listeners.push({ type: type, fn: fn });
    }

    on('mousemove', function (e) {
      if (self._destroyed) return;
      if (!self.opts.ticks) return;
      var rect = canvas.getBoundingClientRect();
      var px = e.clientX - rect.left;
      var py = e.clientY - rect.top;
      if (py < self._chartTop || py > self._chartBottom) {
        if (self.hoverIdx !== -1) { self.hoverIdx = -1; self.draw(); }
        return;
      }
      var idx = self._idxAtX(px);
      if (idx !== self.hoverIdx) { self.hoverIdx = idx; self.draw(); }
    });

    on('mouseleave', function () {
      if (self._destroyed) return;
      if (self.hoverIdx !== -1) { self.hoverIdx = -1; self.draw(); }
    });

    on('dblclick', function (e) {
      if (self._destroyed) return;
      var rect = canvas.getBoundingClientRect();
      var px = e.clientX - rect.left;
      var py = e.clientY - rect.top;
      var hit = self.getCellAt(px, py);
      if (hit) {
        hit.screen = {
          left: rect.left + hit.x,
          top: rect.top + hit.y,
          right: rect.left + hit.x + hit.w,
          bottom: rect.top + hit.y + hit.h
        };
        if (self.opts.onCellDblclick) self.opts.onCellDblclick(hit);
        return;
      }
      if (self.hoverIdx < 0) return;
      if (self.opts.onMark) self.opts.onMark(self.hoverIdx);
    });

    on('contextmenu', function (e) {
      if (self._destroyed) return;
      e.preventDefault();
      if (self.hoverIdx < 0) return;
      var markers = self.opts.markers || [];
      if (markers.length === 0) return;
      var closest = 0;
      for (var i = 1; i < markers.length; i++) {
        if (Math.abs(markers[i] - self.hoverIdx) < Math.abs(markers[closest] - self.hoverIdx))
          closest = i;
      }
      if (self.opts.onMark) self.opts.onMark(markers[closest]);
    });
  };

  // 解绑所有事件 + 清空画布。重新打开浮窗时调用，避免上一次的实例继续监听 mousemove 画旧数据
  IntradayChart.prototype.destroy = function () {
    if (this._destroyed) return;
    this._destroyed = true;
    var canvas = this.canvas;
    for (var i = 0; i < this._listeners.length; i++) {
      canvas.removeEventListener(this._listeners[i].type, this._listeners[i].fn);
    }
    this._listeners = [];
    if (this.ctx && canvas.width && canvas.height) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  // 命中标注表里的量/额单元格
  IntradayChart.prototype.getCellAt = function (px, py) {
    if (!this._cellHits) return null;
    for (var i = 0; i < this._cellHits.length; i++) {
      var h = this._cellHits[i];
      if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) return h;
    }
    return null;
  };

  IntradayChart.prototype._idxAtX = function (px) {
    var n = this.opts.ticks.length;
    var rel = (px - this._padLeft) / this._plotW;
    if (rel < 0 || rel > 1) return -1;
    var i = Math.floor(rel * n);
    return Math.max(0, Math.min(n - 1, i));
  };

  IntradayChart.prototype._xOf = function (i) {
    var n = this.opts.ticks.length;
    return this._padLeft + this._plotW * (i + 0.5) / n;
  };

  IntradayChart.prototype._yOfPrice = function (p) {
    return this._chartTop + this._plotH * (1 - (p - this._priceLo) / (this._priceHi - this._priceLo));
  };

  // 取当前 tick 的涨跌幅（百分比数值，如 0.61 表示 0.61%）
  IntradayChart.prototype._pctAt = function (i) {
    var t = this.opts.ticks[i];
    if (t.c != null) return t.c * 100;  // 来自 Excel 直接给的小数
    var pc = this.opts.prevClose;
    if (pc && t.p) return (t.p / pc - 1) * 100;
    return null;
  };

  IntradayChart.prototype._layout = function () {
    var ticks = this.opts.ticks;
    if (!ticks || ticks.length === 0) return;

    // 适应容器
    var parent = this.canvas.parentElement;
    var W = parent ? parent.clientWidth : 800;
    var H = parent ? parent.clientHeight : 400;

    var dpr = global.devicePixelRatio || 1;
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this._W = W;
    this._H = H;
    this._fs = 11;
    this._rowH = 14;

    this._padLeft = 56;
    this._padRight = 12;
    this._padTop = 14;

    var hasMarkers = (this.opts.markers && this.opts.markers.length > 0);
    var nRows = 5;  // 分钟 / 价格 / 涨跌幅 / 量 / 额
    this._sec1H = hasMarkers ? nRows * this._rowH + 8 : 0;

    this._plotW = W - this._padLeft - this._padRight;
    var bottomReserve = 18;  // X 轴标签
    this._chartTop = this._padTop;
    this._plotH = H - this._padTop - bottomReserve - this._sec1H - (hasMarkers ? 12 : 0);
    if (this._plotH < 60) this._plotH = 60;
    this._chartBottom = this._chartTop + this._plotH;
    this._sec1Top = this._chartBottom + bottomReserve + 4;

    // 价格区间：包含昨收作为参考线（如果有）
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < ticks.length; i++) {
      if (ticks[i].p == null) continue;
      if (ticks[i].p < lo) lo = ticks[i].p;
      if (ticks[i].p > hi) hi = ticks[i].p;
    }
    if (this.opts.prevClose) {
      if (this.opts.prevClose < lo) lo = this.opts.prevClose;
      if (this.opts.prevClose > hi) hi = this.opts.prevClose;
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    var pad = (hi - lo) * 0.08 || (lo * 0.005) || 0.02;
    this._priceLo = lo - pad;
    this._priceHi = hi + pad;
  };

  IntradayChart.prototype.draw = function () {
    var ticks = this.opts.ticks;
    if (!ticks || ticks.length === 0) return;
    this._layout();
    var ctx = this.ctx;
    var W = this._W, H = this._H;

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    // Y 轴价格刻度 + 网格
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;
    ctx.fillStyle = COLOR_TEXT_3;
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    for (var gi = 0; gi <= 4; gi++) {
      var y = this._chartTop + this._plotH * gi / 4;
      ctx.beginPath();
      ctx.moveTo(this._padLeft, y);
      ctx.lineTo(this._padLeft + this._plotW, y);
      ctx.stroke();
      var p = this._priceHi - (this._priceHi - this._priceLo) * gi / 4;
      ctx.fillText(p.toFixed(2), this._padLeft - 6, y + 3);
    }

    // 昨收水平参考线（虚线）
    if (this.opts.prevClose) {
      var yPC = this._yOfPrice(this.opts.prevClose);
      ctx.strokeStyle = COLOR_TEXT_3;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this._padLeft, yPC);
      ctx.lineTo(this._padLeft + this._plotW, yPC);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLOR_TEXT_3;
      ctx.font = '9px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('昨收 ' + this.opts.prevClose.toFixed(2), this._padLeft + 4, yPC - 2);
    }

    // 标记线
    var markers = this.opts.markers || [];
    var markersSorted = markers.slice().sort(function (a, b) { return a - b; });
    ctx.strokeStyle = COLOR_MARKER;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    for (var mi = 0; mi < markersSorted.length; mi++) {
      var idxM = markersSorted[mi];
      if (idxM < 0 || idxM >= ticks.length) continue;
      var xM = this._xOf(idxM);
      ctx.beginPath();
      ctx.moveTo(xM, this._chartTop);
      ctx.lineTo(xM, this._chartBottom);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // 价格折线（去除空价格）
    ctx.strokeStyle = '#2563eb';  // 蓝色分时线
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    var firstPlot = true;
    for (var i = 0; i < ticks.length; i++) {
      if (ticks[i].p == null) continue;
      var x = this._xOf(i);
      var y = this._yOfPrice(ticks[i].p);
      if (firstPlot) { ctx.moveTo(x, y); firstPlot = false; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // X 轴时间标签：每 30 分钟一格
    ctx.fillStyle = COLOR_TEXT_3;
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    var labelTimes = ['09:30', '10:00', '10:30', '11:00', '11:30',
                      '13:00', '13:30', '14:00', '14:30', '15:00'];
    var lastLabelX = -100;
    for (var i = 0; i < ticks.length; i++) {
      if (labelTimes.indexOf(ticks[i].t) < 0) continue;
      var lx = this._xOf(i);
      if (lx - lastLabelX < 36) continue;
      ctx.fillText(ticks[i].t, lx, this._chartBottom + 13);
      lastLabelX = lx;
    }

    // hover
    if (this.hoverIdx >= 0 && this.hoverIdx < ticks.length) {
      var hx = this._xOf(this.hoverIdx);
      ctx.strokeStyle = 'rgba(17,24,39,0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, this._chartTop);
      ctx.lineTo(hx, this._chartBottom);
      ctx.stroke();
      ctx.setLineDash([]);

      var ht = ticks[this.hoverIdx];
      var hp = this._pctAt(this.hoverIdx);
      var lblText = ht.t + '   ' + (ht.p != null ? ht.p.toFixed(2) : '-') +
        (hp != null ? '   ' + (hp >= 0 ? '+' : '') + hp.toFixed(2) + '%' : '');
      ctx.font = '11px -apple-system, sans-serif';
      var tw = ctx.measureText(lblText).width + 14;
      var lx2 = hx - tw / 2;
      if (lx2 < this._padLeft) lx2 = this._padLeft;
      if (lx2 + tw > W - this._padRight) lx2 = W - this._padRight - tw;
      ctx.fillStyle = COLOR_TEXT;
      ctx.fillRect(lx2, this._chartTop, tw, 18);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(lblText, lx2 + tw / 2, this._chartTop + 13);
    }

    // ===== 标注数据表（5 行：分钟 / 价格 / 涨跌幅 / 交易量 / 交易额）=====
    if (markersSorted.length > 0) {
      this._drawMarkerTable(markersSorted);
    }
  };

  IntradayChart.prototype._drawMarkerTable = function (markers) {
    var ctx = this.ctx;
    var ticks = this.opts.ticks;
    var fs = this._fs;
    var rowH = this._rowH;

    var rowMin = 0, rowPrice = 1, rowChg = 2, rowVol = 3, rowAmt = 4;
    var totalRows = 5;
    var top = this._sec1Top;
    var labelX = this._padLeft - 8;

    this._cellHits = [];
    var _calcDraftSet = this.opts.calcDraftKeys || null;
    var _calcSavedSet = this.opts.calcSavedKeys || null;

    // 左侧标签列
    ctx.font = '600 ' + fs + 'px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = COLOR_TEXT_3;
    ctx.fillText('分钟', labelX, top + rowMin * rowH + fs);
    ctx.fillStyle = COLOR_TEXT_2;
    ctx.fillText('价格', labelX, top + rowPrice * rowH + fs);
    ctx.fillText('涨跌幅', labelX, top + rowChg * rowH + fs);
    ctx.fillText('交易量', labelX, top + rowVol * rowH + fs);
    ctx.fillText('交易额', labelX, top + rowAmt * rowH + fs);

    // 计算每个 marker 列的 (x, ha)
    var closeThresh = (this._plotW / ticks.length) * 4;
    var cols = [];
    for (var mi = 0; mi < markers.length; mi++) {
      var idx = markers[mi];
      if (idx < 0 || idx >= ticks.length) continue;
      var x = this._xOf(idx);
      var ha = 'center';
      var prev = mi > 0 ? this._xOf(markers[mi - 1]) : -Infinity;
      var next = mi < markers.length - 1 ? this._xOf(markers[mi + 1]) : Infinity;
      var prevClose = (x - prev) < closeThresh;
      var nextClose = (next - x) < closeThresh;
      if (prevClose && !nextClose) { ha = 'left'; x += 2; }
      else if (nextClose && !prevClose) { ha = 'right'; x -= 2; }
      cols.push({ idx: idx, x: x, ha: ha });
    }

    // 找出 hover 命中的 marker（鼠标在 chart 区域且离最近的 marker 不超过 1.2 倍 tick 宽）
    var hoverCol = -1;
    if (this.hoverIdx >= 0) {
      var hoverX = this._xOf(this.hoverIdx);
      var bestDist = Infinity, bestI = -1;
      for (var c = 0; c < cols.length; c++) {
        var d = Math.abs(this._xOf(cols[c].idx) - hoverX);
        if (d < bestDist) { bestDist = d; bestI = c; }
      }
      // 阈值：marker 数量越多越宽松，至少 30px
      var th = Math.max(30, this._plotW / Math.max(1, ticks.length) * 4);
      if (bestI >= 0 && bestDist <= th) hoverCol = bestI;
    }

    var self = this;
    function drawCol(ci) {
      var col = cols[ci];
      var t = ticks[col.idx];
      var pct = self._pctAt(col.idx);
      ctx.textAlign = col.ha;

      ctx.font = '600 ' + (fs - 1) + 'px -apple-system, sans-serif';
      ctx.fillStyle = COLOR_MARKER;
      ctx.fillText(t.t, col.x, top + rowMin * rowH + fs);

      ctx.font = '600 ' + fs + 'px -apple-system, "PingFang SC", sans-serif';
      ctx.fillStyle = COLOR_TEXT;
      ctx.fillText(t.p != null ? t.p.toFixed(2) : '-', col.x, top + rowPrice * rowH + fs);

      ctx.font = '600 ' + (fs - 1) + 'px -apple-system, sans-serif';
      ctx.fillStyle = pctColor(pct);
      ctx.fillText(fmtPct(pct), col.x, top + rowChg * rowH + fs);

      ctx.font = '600 ' + fs + 'px -apple-system, "PingFang SC", sans-serif';
      var volKey = t.t + '|volume';
      var amtKey = t.t + '|amount';
      var volSelected = t.v != null && (
        (_calcDraftSet && _calcDraftSet.has(volKey)) ||
        (_calcSavedSet && _calcSavedSet.has(volKey))
      );
      var amtSelected = t.a != null && (
        (_calcDraftSet && _calcDraftSet.has(amtKey)) ||
        (_calcSavedSet && _calcSavedSet.has(amtKey))
      );
      ctx.fillStyle = volSelected ? COLOR_CALC : COLOR_TEXT;
      ctx.fillText(t.v != null ? formatCount(t.v) : '-', col.x, top + rowVol * rowH + fs);
      ctx.fillStyle = amtSelected ? COLOR_CALC : COLOR_TEXT;
      ctx.fillText(t.a != null ? formatCount(t.a) : '-', col.x, top + rowAmt * rowH + fs);

      // 记录可点击单元格（仅 v 和 a 行有数据时才记录）
      var halfW = 36;
      if (t.v != null) {
        self._cellHits.push({
          idx: col.idx, time: t.t, col: 'volume', value: t.v,
          key: t.t + '|volume',
          x: col.x - halfW, y: top + rowVol * rowH - 1,
          w: halfW * 2, h: rowH + 1
        });
      }
      if (t.a != null) {
        self._cellHits.push({
          idx: col.idx, time: t.t, col: 'amount', value: t.a,
          key: t.t + '|amount',
          x: col.x - halfW, y: top + rowAmt * rowH - 1,
          w: halfW * 2, h: rowH + 1
        });
      }
    }

    // ===== 阶段 1：先画所有 marker 列（被选入计算的量/额格子文字会染红） =====
    for (var i = 0; i < cols.length; i++) drawCol(i);

    // ===== 阶段 2：hover 高亮 —— 白底矩形覆盖相邻列 + 重画该列 + 边框 =====
    if (hoverCol >= 0) {
      var hCol = cols[hoverCol];
      // 估算这一列各行最宽的字串，用于决定白底宽度
      ctx.font = '600 ' + fs + 'px -apple-system, "PingFang SC", sans-serif';
      var t = ticks[hCol.idx];
      var pct = this._pctAt(hCol.idx);
      var widths = [
        ctx.measureText(t.t).width,
        ctx.measureText(t.p != null ? t.p.toFixed(2) : '-').width,
        ctx.measureText(fmtPct(pct)).width,
        ctx.measureText(t.v != null ? formatCount(t.v) : '-').width,
        ctx.measureText(t.a != null ? formatCount(t.a) : '-').width
      ];
      var maxW = 0;
      for (var w = 0; w < widths.length; w++) if (widths[w] > maxW) maxW = widths[w];
      var pad = 8;
      var boxW = maxW + pad * 2;
      var boxH = totalRows * rowH + 6;
      var boxX;
      if (hCol.ha === 'left')       boxX = hCol.x - pad;
      else if (hCol.ha === 'right') boxX = hCol.x - boxW + pad;
      else                          boxX = hCol.x - boxW / 2;
      var boxY = top - 2;

      // 画底色（不透明白）+ 浅描边
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeStyle = COLOR_MARKER;
      ctx.lineWidth = 1;
      ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

      // 在白底上重画该列文字（颜色不变，已足够清晰）
      drawCol(hoverCol);
    }
  };

  // 紧凑数字：超过 1 万自动转 "X.XX万" / "X.XX亿"
  function formatCount(v) {
    if (v == null || !isFinite(v)) return '-';
    var av = Math.abs(v);
    if (av >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (av >= 1e4) return (v / 1e4).toFixed(2) + '万';
    return Math.round(v).toLocaleString();
  }

  global.YcctChart = YcctChart;
  global.YcctIntradayChart = IntradayChart;
  global.YcctChartUtils = {
    computeIntervals: computeIntervals,
    computeChangePct: computeChangePct
  };
})(window);
