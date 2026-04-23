/* 量化基金全景看板 - 前端交互逻辑（白色主题）*/
(function () {
  'use strict';

  const COLORS = {
    canvas:  '#F8FAFC',
    card:    '#FFFFFF',
    soft:    '#F1F5F9',
    border:  '#E2E8F0',
    line:    '#CBD5E1',
    heading: '#0F172A',
    text:    '#334155',
    dim:     '#64748B',
    muted:   '#94A3B8',
    gain:    '#EF4444',
    loss:    '#10B981',
    palette: [
      '#0F172A', '#0284C7', '#7C3AED', '#DB2777',
      '#EA580C', '#CA8A04', '#059669', '#0891B2',
      '#4338CA', '#BE123C', '#15803D', '#92400E',
    ],
  };

  // ---------------- 工具函数 ----------------
  const fmtPct = (v, digits = 2) => {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    const sign = v > 0 ? '+' : '';
    return sign + v.toFixed(digits) + '%';
  };
  const fmtNum = (v, digits = 2) => {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };
  const fmtInt = (v) => v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US');
  const cls = (v) => v === null || v === undefined || Number.isNaN(v) ? 'text-ink-500' : (v > 0 ? 'text-gain' : (v < 0 ? 'text-loss' : 'text-ink-600'));

  async function loadJSON(path) {
    const r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) throw new Error('加载失败: ' + path);
    return r.json();
  }

  function mountIcons() {
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
  }

  // ---------------- Hero 指标 ----------------
  function renderOverview(ov) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const setCls = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('text-gain', 'text-loss', 'text-ink-500', 'text-ink-950');
      if (v === null || v === undefined || Number.isNaN(v)) el.classList.add('text-ink-500');
      else if (v > 0) el.classList.add('text-gain');
      else if (v < 0) el.classList.add('text-loss');
      else el.classList.add('text-ink-950');
    };

    set('asof-date', ov.asOf || '—');
    set('m-asof',    ov.asOf || '—');
    set('mm-asof',   ov.asOf || '—');

    set('m-total',  fmtInt(ov.totalFunds));
    set('m-priv',   fmtInt(ov.privateFunds));
    set('m-pub',    fmtInt(ov.publicFunds));
    set('m-stratn', fmtInt(ov.strategyCount));

    set('m-ann',      fmtPct(ov.annMedian));  setCls('m-ann', ov.annMedian);
    set('m-ann-mean', fmtPct(ov.annMean));
    set('m-ann-top',  fmtPct(ov.annTop1pct));

    set('m-ytd',      fmtPct(ov.ytdMedian));  setCls('m-ytd', ov.ytdMedian);
    set('m-ytd-mean', fmtPct(ov.ytdMean));
    set('m-ytd-win',  ov.ytdWinRate !== null ? ov.ytdWinRate.toFixed(1) + '%' : '—');

    set('m-daily',     fmtPct(ov.dailyMean, 3)); setCls('m-daily', ov.dailyMean);
    set('m-daily-win', ov.dailyWinRate !== null ? ov.dailyWinRate.toFixed(1) + '%' : '—');
  }

  // ---------------- 结论要点 ----------------
  function renderTakeaways(ov, cmp, heat) {
    const ul = document.getElementById('takeaways');
    if (!ul) return;
    const items = [];

    items.push(`全市场共覆盖 <b class="text-ink-950 num">${fmtInt(ov.totalFunds)}</b> 只量化基金，
      其中私募 <span class="num">${fmtInt(ov.privateFunds)}</span> 只、公募 <span class="num">${fmtInt(ov.publicFunds)}</span> 只。`);

    items.push(`年初至今正收益占比 <b class="text-gain num">${ov.ytdWinRate?.toFixed(1) ?? '—'}%</b>，
      中位收益 <b class="${ov.ytdMedian >= 0 ? 'text-gain' : 'text-loss'} num">${fmtPct(ov.ytdMedian)}</b>，
      年化中位 <b class="${ov.annMedian >= 0 ? 'text-gain' : 'text-loss'} num">${fmtPct(ov.annMedian)}</b>。`);

    try {
      const pi = cmp.periods.indexOf('近一年');
      if (pi >= 0) {
        const scored = cmp.series.map(s => ({ name: s.name, v: s.values[pi] })).filter(s => s.v !== null);
        scored.sort((a,b) => b.v - a.v);
        if (scored.length) {
          items.push(`按近一年收益中位数，领先策略为 <b class="text-ink-950">${scored[0].name}</b>
            （<span class="text-gain num">${fmtPct(scored[0].v)}</span>），
            落后策略为 <b class="text-ink-950">${scored[scored.length-1].name}</b>
            （<span class="${scored[scored.length-1].v>=0?'text-gain':'text-loss'} num">${fmtPct(scored[scored.length-1].v)}</span>）。`);
        }
      }
    } catch (e) { /* ignore */ }

    try {
      const pi = cmp.periods.indexOf('近一年');
      const pub = cmp.series.filter(s => s.name.startsWith('公募'));
      const priv = cmp.series.filter(s => !s.name.startsWith('公募'));
      const avg = arr => {
        const xs = arr.map(s => s.values[pi]).filter(v => v !== null);
        if (!xs.length) return null;
        return xs.reduce((a,b)=>a+b,0) / xs.length;
      };
      const pub_v = avg(pub), priv_v = avg(priv);
      if (pub_v !== null && priv_v !== null) {
        items.push(`近一年公募量化平均约 <b class="${pub_v>=0?'text-gain':'text-loss'} num">${fmtPct(pub_v)}</b>，
          私募量化平均约 <b class="${priv_v>=0?'text-gain':'text-loss'} num">${fmtPct(priv_v)}</b>，
          差异 <span class="num">${fmtPct(pub_v - priv_v)}</span>（反映同期 Beta 暴露差异）。`);
      }
    } catch (e) { /* ignore */ }

    items.push(`热力图：负值以 <span class="text-loss">红</span>、正值以 <span class="text-gain">绿</span> 显示；
      同一策略行内颜色由冷至暖代表期间拉长后的收益累积。`);

    ul.innerHTML = items.map(t => `<li class="marker:text-ink-400">${t}</li>`).join('');
  }

  // ---------------- 策略对比图 ----------------
  let chartCompare = null;
  function renderCompare(cmp, mode = 'bar') {
    const el = document.getElementById('chart-compare');
    if (!chartCompare) chartCompare = echarts.init(el, null, { renderer: 'canvas' });
    const series = cmp.series.map((s, i) => ({
      name: s.name,
      type: mode,
      data: s.values,
      smooth: mode === 'line',
      symbol: 'circle',
      symbolSize: 6,
      itemStyle: { color: COLORS.palette[i % COLORS.palette.length] },
      lineStyle: mode === 'line' ? { width: 1.8 } : undefined,
      barMaxWidth: 16,
      barGap: '10%',
      emphasis: { focus: 'series' },
    }));
    chartCompare.setOption({
      backgroundColor: 'transparent',
      grid: { left: 48, right: 24, top: 36, bottom: 60, containLabel: true },
      legend: {
        bottom: 0, type: 'scroll', itemWidth: 10, itemHeight: 10, icon: 'rect',
        textStyle: { color: COLORS.dim, fontSize: 11 },
        pageTextStyle: { color: COLORS.dim },
        pageIconColor: COLORS.text,
        pageIconInactiveColor: COLORS.line,
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: COLORS.card,
        borderColor: COLORS.border,
        borderWidth: 1,
        textStyle: { color: COLORS.text, fontSize: 12 },
        axisPointer: {
          type: mode === 'line' ? 'cross' : 'shadow',
          lineStyle: { color: COLORS.line },
          shadowStyle: { color: 'rgba(15, 23, 42, 0.04)' },
        },
        valueFormatter: (v) => v === null || v === undefined ? '—' : v.toFixed(2) + '%',
        extraCssText: 'box-shadow: 0 1px 3px rgba(15,23,42,0.08);',
      },
      xAxis: {
        type: 'category', data: cmp.periods,
        axisLine: { lineStyle: { color: COLORS.border } },
        axisTick: { show: false },
        axisLabel: { color: COLORS.dim, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: COLORS.soft, type: 'dashed' } },
        axisLabel: { color: COLORS.dim, fontSize: 11, formatter: '{value}%' },
      },
      series,
    }, true);
  }

  // ---------------- 热力图 ----------------
  let chartHeat = null;
  function renderHeatmap(h) {
    const el = document.getElementById('chart-heatmap');
    if (!chartHeat) chartHeat = echarts.init(el, null, { renderer: 'canvas' });

    const flatVals = h.matrix.map(x => x[2]).filter(v => v !== null && !Number.isNaN(v));
    const absMax = Math.max(10, Math.ceil(Math.max(...flatVals.map(Math.abs)) || 10));

    chartHeat.setOption({
      backgroundColor: 'transparent',
      grid: { left: 120, right: 40, top: 16, bottom: 40 },
      tooltip: {
        backgroundColor: COLORS.card,
        borderColor: COLORS.border,
        borderWidth: 1,
        textStyle: { color: COLORS.text, fontSize: 12 },
        extraCssText: 'box-shadow: 0 1px 3px rgba(15,23,42,0.08);',
        formatter: (p) => {
          const period = h.periods[p.data[0]];
          const strat = h.strategies[p.data[1]];
          const v = p.data[2];
          return `<div style="font-size:11px;color:${COLORS.dim};letter-spacing:.08em">${strat}</div>
                  <div style="margin-top:2px;color:${COLORS.text}">${period} · <span style="font-family:'JetBrains Mono',monospace;color:${v>=0?COLORS.gain:COLORS.loss}">${v===null?'—':v.toFixed(2)+'%'}</span></div>`;
        }
      },
      xAxis: {
        type: 'category', data: h.periods,
        splitArea: { show: false },
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: COLORS.dim, fontSize: 11 },
      },
      yAxis: {
        type: 'category', data: h.strategies,
        splitArea: { show: false },
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: COLORS.heading, fontSize: 12 },
      },
      visualMap: {
        min: -absMax, max: absMax,
        calculable: false, show: false,
        inRange: { color: ['#047857', '#6EE7B7', '#D1FAE5', '#F1F5F9', '#FEE2E2', '#FCA5A5', '#B91C1C'] },
      },
      series: [{
        name: '中位收益',
        type: 'heatmap',
        data: h.matrix,
        label: {
          show: true,
          color: COLORS.heading,
          fontSize: 11,
          fontFamily: 'JetBrains Mono, monospace',
          formatter: (p) => p.data[2] === null ? '—' : p.data[2].toFixed(1),
        },
        itemStyle: { borderColor: COLORS.card, borderWidth: 2 },
        emphasis: { itemStyle: { borderColor: COLORS.heading, borderWidth: 1 } },
      }],
    }, true);
  }

  // ---------------- 策略明细表 ----------------
  function renderBreakdown(stats, period) {
    const tbody = document.getElementById('bk-body');
    if (!tbody) return;
    const rows = stats.slice().sort((a,b) => {
      const av = a[period]?.median ?? -Infinity;
      const bv = b[period]?.median ?? -Infinity;
      return bv - av;
    });
    tbody.innerHTML = rows.map(r => {
      const s = r[period] || {};
      const c = (v) => v === null || v === undefined ? 'text-ink-500' : (v > 0 ? 'text-gain' : v < 0 ? 'text-loss' : '');
      return `
        <tr class="hairline-b hover:bg-ink-100">
          <td class="px-5 text-left font-medium text-ink-950">${r.strategy}</td>
          <td class="text-right text-ink-700">${fmtInt(s.count ?? r.count)}</td>
          <td class="text-right ${c(s.mean)}">${fmtPct(s.mean)}</td>
          <td class="text-right ${c(s.median)} font-semibold">${fmtPct(s.median)}</td>
          <td class="text-right text-ink-700">${fmtPct(s.p25)}</td>
          <td class="text-right text-ink-700">${fmtPct(s.p75)}</td>
          <td class="text-right ${c(s.max)}">${fmtPct(s.max)}</td>
          <td class="text-right ${c(s.min)}">${fmtPct(s.min)}</td>
          <td class="text-right text-ink-700">${s.std === null || s.std === undefined ? '—' : s.std.toFixed(2)}</td>
          <td class="text-right pr-5 ${s.win_rate>=0.5?'text-gain':'text-loss'}">${s.win_rate === null || s.win_rate === undefined ? '—' : (s.win_rate*100).toFixed(1) + '%'}</td>
        </tr>`;
    }).join('');
  }

  // ---------------- Top / Bottom Movers ----------------
  function renderMovers(moversData, mountId, key) {
    const mount = document.getElementById(mountId);
    if (!mount) return;
    const rows = moversData[key] || [];
    mount.innerHTML = `
      <div class="divide-y" style="--tw-divide-opacity:1;">
        ${rows.map((r, i) => `
          <div class="flex items-center gap-3 px-3 py-2 hover:bg-ink-100" style="border-bottom: 1px solid #F1F5F9;">
            <div class="num text-[11px] text-ink-500 w-6 text-right">${(i+1).toString().padStart(2, '0')}</div>
            <div class="flex-1 min-w-0">
              <div class="text-[13px] text-ink-950 truncate">${r.name}</div>
              <div class="text-[11px] text-ink-500 num flex items-center gap-2 mt-0.5">
                <span>${r.code}</span>
                <span class="chip px-1.5 py-0.5 rounded-sm text-[10px]">${r.strategy}</span>
                <span class="text-ink-400">${r.source}</span>
              </div>
            </div>
            <div class="num text-[14px] font-semibold ${r.value>=0?'text-gain':'text-loss'}">${fmtPct(r.value)}</div>
          </div>`).join('')}
      </div>`;
  }

  // ---------------- Screener ----------------
  const sc = {
    all: [],
    view: [],
    sources: [],
    strategies: [],
    activeSources: new Set(),
    activeStrategies: new Set(),
    sortKey: '年初至今',
    sortDir: -1,
    q: '',
    page: 0,
    pageSize: 25,
  };

  function initScreener(rows) {
    sc.all = rows;
    sc.sources = Array.from(new Set(rows.map(r => r['来源']).filter(Boolean))).sort();
    sc.strategies = Array.from(new Set(rows.map(r => r['策略']).filter(Boolean)));
    sc.activeSources = new Set(sc.sources);
    sc.activeStrategies = new Set(sc.strategies);

    const srcMount = document.getElementById('sc-source');
    const stMount  = document.getElementById('sc-strategy');
    srcMount.innerHTML = sc.sources.map(s => `<button class="tab-active px-2 py-0.5 rounded-sm border" data-v="${s}">${s}</button>`).join('');
    stMount.innerHTML  = sc.strategies.map(s => `<button class="tab-active px-2 py-0.5 rounded-sm border" data-v="${s}">${s}</button>`).join('');

    const toggle = (b, active) => {
      if (active) {
        b.classList.add('tab-active'); b.classList.remove('tab-idle');
        b.style.background = '#0F172A'; b.style.color = '#FFFFFF'; b.style.borderColor = '#0F172A';
      } else {
        b.classList.remove('tab-active'); b.classList.add('tab-idle');
        b.style.background = '#FFFFFF'; b.style.color = '#64748B'; b.style.borderColor = '#E2E8F0';
      }
    };

    srcMount.querySelectorAll('button').forEach(b => {
      toggle(b, true);
      b.addEventListener('click', () => {
        const v = b.dataset.v;
        const active = !sc.activeSources.has(v);
        if (active) sc.activeSources.add(v); else sc.activeSources.delete(v);
        toggle(b, active);
        sc.page = 0; applyFilter();
      });
    });
    stMount.querySelectorAll('button').forEach(b => {
      toggle(b, true);
      b.addEventListener('click', () => {
        const v = b.dataset.v;
        const active = !sc.activeStrategies.has(v);
        if (active) sc.activeStrategies.add(v); else sc.activeStrategies.delete(v);
        toggle(b, active);
        sc.page = 0; applyFilter();
      });
    });

    document.getElementById('sc-q').addEventListener('input', (e) => {
      sc.q = (e.target.value || '').trim().toLowerCase();
      sc.page = 0; applyFilter();
    });

    document.querySelectorAll('#screener thead th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (sc.sortKey === k) sc.sortDir *= -1;
        else { sc.sortKey = k; sc.sortDir = ['代码','名称','策略','来源'].includes(k) ? 1 : -1; }
        applyFilter();
      });
    });

    document.getElementById('sc-prev').addEventListener('click', () => { if (sc.page > 0) { sc.page--; renderScreener(); } });
    document.getElementById('sc-next').addEventListener('click', () => {
      const total = Math.max(1, Math.ceil(sc.view.length / sc.pageSize));
      if (sc.page < total - 1) { sc.page++; renderScreener(); }
    });

    document.getElementById('sc-export').addEventListener('click', exportCSV);

    applyFilter();
  }

  function applyFilter() {
    let v = sc.all.filter(r =>
      sc.activeSources.has(r['来源']) &&
      sc.activeStrategies.has(r['策略'])
    );
    if (sc.q) {
      v = v.filter(r =>
        (r['代码'] || '').toLowerCase().includes(sc.q) ||
        (r['名称'] || '').toLowerCase().includes(sc.q) ||
        (r['管理人'] || '').toLowerCase().includes(sc.q) ||
        (r['策略'] || '').toLowerCase().includes(sc.q)
      );
    }
    v.sort((a,b) => {
      const av = a[sc.sortKey], bv = b[sc.sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sc.sortDir;
      return String(av).localeCompare(String(bv), 'zh') * sc.sortDir;
    });
    sc.view = v;
    renderScreener();
  }

  function renderScreener() {
    const tbody = document.getElementById('sc-body');
    const total = sc.view.length;
    const pages = Math.max(1, Math.ceil(total / sc.pageSize));
    if (sc.page >= pages) sc.page = pages - 1;
    const start = sc.page * sc.pageSize;
    const rows = sc.view.slice(start, start + sc.pageSize);

    tbody.innerHTML = rows.map(r => {
      const c = (v) => v === null || v === undefined ? 'text-ink-500' : (v > 0 ? 'text-gain' : v < 0 ? 'text-loss' : 'text-ink-700');
      return `<tr class="hairline-b hover:bg-ink-100">
        <td class="px-5 text-left text-ink-800">${r['代码'] || ''}</td>
        <td class="text-left"><span class="text-ink-950">${r['名称'] || ''}</span>${r['管理人'] ? `<span class="text-ink-500 ml-2 text-[11px]">${r['管理人']}</span>` : ''}</td>
        <td class="text-left"><span class="chip px-1.5 py-0.5 rounded-sm text-[11px]">${r['策略'] || ''}</span></td>
        <td class="text-left text-ink-500 text-[11px]">${r['来源'] || ''}</td>
        <td class="text-right ${c(r['日回报'])}">${fmtPct(r['日回报'])}</td>
        <td class="text-right ${c(r['近一周'])}">${fmtPct(r['近一周'])}</td>
        <td class="text-right ${c(r['近一月'])}">${fmtPct(r['近一月'])}</td>
        <td class="text-right ${c(r['近一季'])}">${fmtPct(r['近一季'])}</td>
        <td class="text-right ${c(r['近半年'])}">${fmtPct(r['近半年'])}</td>
        <td class="text-right ${c(r['近一年'])}">${fmtPct(r['近一年'])}</td>
        <td class="text-right ${c(r['近两年'])}">${fmtPct(r['近两年'])}</td>
        <td class="text-right ${c(r['年初至今'])}">${fmtPct(r['年初至今'])}</td>
        <td class="text-right pr-5 font-semibold ${c(r['年化回报'])}">${fmtPct(r['年化回报'])}</td>
      </tr>`;
    }).join('');

    document.getElementById('sc-count').textContent = `共 ${total.toLocaleString('en-US')} 条 · 第 ${sc.page+1} / ${pages} 页`;
    document.getElementById('sc-page-info').textContent = `第 ${start+1}-${Math.min(start+sc.pageSize, total)} 条 / 共 ${total.toLocaleString('en-US')} 条`;
  }

  function exportCSV() {
    const header = ['代码','名称','策略','来源','管理人','基金规模(亿元)','日回报','年初至今','近一周','近一月','近一季','近半年','近一年','近两年','成立以来','年化回报'];
    const esc = (s) => {
      if (s === null || s === undefined) return '';
      const v = String(s);
      if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
      return v;
    };
    const lines = [header.join(',')];
    sc.view.forEach(r => lines.push(header.map(h => esc(r[h])).join(',')));
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quant_funds_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------------- Tab 切换 ----------------
  function bindTabGroup(containerId, onChange) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      c.querySelectorAll('button').forEach(x => { x.classList.remove('tab-active','hairline'); x.classList.add('tab-idle'); });
      b.classList.add('tab-active','hairline'); b.classList.remove('tab-idle');
      onChange(b.dataset);
    }));
  }

  // ---------------- 主流程 ----------------
  async function main() {
    try {
      const [overview, cmp, heat, stats, movers, funds] = await Promise.all([
        loadJSON('./data/overview.json'),
        loadJSON('./data/strategy_compare.json'),
        loadJSON('./data/heatmap.json'),
        loadJSON('./data/strategy_stats.json'),
        loadJSON('./data/top_movers.json'),
        loadJSON('./data/all_funds.json'),
      ]);

      renderOverview(overview);
      renderTakeaways(overview, cmp, heat);
      renderCompare(cmp, 'bar');
      renderHeatmap(heat);
      renderBreakdown(stats, '近一年');
      renderMovers(movers, 'mv-top', 'ytd_top');
      renderMovers(movers, 'mv-bot', 'ytd_bot');
      initScreener(funds);

      document.getElementById('bk-period').addEventListener('change', (e) => {
        renderBreakdown(stats, e.target.value);
      });

      bindTabGroup('compare-mode', (ds) => renderCompare(cmp, ds.mode));
      bindTabGroup('mv-top-mode', (ds) => renderMovers(movers, 'mv-top', ds.k));
      bindTabGroup('mv-bot-mode', (ds) => renderMovers(movers, 'mv-bot', ds.k));

      window.addEventListener('resize', () => {
        chartCompare && chartCompare.resize();
        chartHeat && chartHeat.resize();
      });

      mountIcons();
    } catch (err) {
      console.error(err);
      const body = document.body;
      const msg = document.createElement('div');
      msg.className = 'fixed bottom-4 right-4 card p-3 text-[12px] text-loss';
      msg.textContent = '数据加载失败：' + err.message;
      body.appendChild(msg);
    }
  }

  document.addEventListener('DOMContentLoaded', main);
})();
