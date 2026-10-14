/* global Chart */
(function () {
  'use strict';

  const app       = document.getElementById('app');
  const GAME_UUID = app.dataset.gameUuid;
  const SMOOTH    = app.dataset.smooth === '1';
  const POLL_MS   = 5000;

  let chart = null;

  // ── Smoothing ─────────────────────────────────────────────────────────────

  function buildGaussianKernel(size, sigma) {
    const half   = Math.floor(size / 2);
    const kernel = [];
    let sum = 0;
    for (let i = 0; i < size; i++) {
      const x   = i - half;
      const val = Math.exp(-(x * x) / (2 * sigma * sigma));
      kernel.push(val);
      sum += val;
    }
    return kernel.map(v => v / sum);
  }

  function gaussianSmooth(data, windowSize, sigma) {
    windowSize = windowSize || 15;
    sigma      = sigma      || 5;
    if (!data.length) return [];
    const kernel = buildGaussianKernel(windowSize, sigma);
    const halfW  = Math.floor(windowSize / 2);
    return data.map(function (_, i) {
      var wSum = 0, wTotal = 0;
      for (var j = 0; j < windowSize; j++) {
        var idx = i - halfW + j;
        if (idx < 0 || idx >= data.length) continue;
        wSum   += data[idx] * kernel[j];
        wTotal += kernel[j];
      }
      return wTotal > 0 ? wSum / wTotal : 0;
    });
  }

  // ── Formatting ────────────────────────────────────────────────────────────

  function formatTime(seconds) {
    return Math.floor(seconds / 60) + 'min';
  }

  function buildLabels(readings) {
    return readings.map(function (r) { return formatTime(r.t); });
  }

  // ── Chart init ────────────────────────────────────────────────────────────

  function initChart() {
    const ctx = document.getElementById('goldChart').getContext('2d');
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels:   [],
        datasets: [{
          label:       'Gold Difference',
          data:        [],
          borderWidth: 2,
          pointRadius: 0,
          tension:     0,
          fill: {
            target: { value: 0 },
            above:  'rgba(59,130,246,0.15)',
            below:  'rgba(239,68,68,0.15)',
          },
          segment: {
            borderColor: function (ctx) {
              return (ctx.p0.parsed.y >= 0) ? '#3b82f6' : '#ef4444';
            },
          },
        }],
      },
      options: {
        responsive:          false,
        animation:           false,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode:      'index',
        },
        scales: {
          x: {
            type:  'category',
            ticks: {
              maxTicksLimit: 12,
              autoSkip:      true,
              color:         '#64748b',
              maxRotation:   0,
            },
            grid:  { color: '#1e293b' },
          },
          y: {
            ticks: {
              color: '#64748b',
              callback: function (v) {
                return (Number(v) > 0 ? '+' : '') + Number(v).toFixed(1) + 'k';
              },
            },
            grid: {
              color: function (ctx) {
                return ctx.tick.value === 0 ? '#475569' : '#1e293b';
              },
            },
            afterDataLimits: function (scale) {
              if (scale.max < 5)  scale.max = 5;
              if (scale.min > -5) scale.min = -5;
              scale.max += 1;
              scale.min -= 1;
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e293b',
            borderColor:     '#334155',
            borderWidth:     1,
            titleColor:      '#94a3b8',
            bodyColor:       '#e2e8f0',
            callbacks: {
              title: function (items) { return items[0].label; },
              label: function (ctx) {
                var v = ctx.parsed.y;
                return (v > 0 ? 'Blue +' : 'Red +') + Math.abs(v).toFixed(1) + 'k';
              },
            },
          },
        },
      },
    });
  }

  // ── Update chart ──────────────────────────────────────────────────────────

  function updateChart(data) {
    if (!data.readings || !data.readings.length) {
      document.getElementById('emptyState').style.display = 'block';
      return;
    }
    document.getElementById('emptyState').style.display = 'none';

    var rawDiffs = data.readings.map(function (r) { return r.diff; });
    var diffs    = SMOOTH ? gaussianSmooth(rawDiffs) : rawDiffs;
    var labels   = buildLabels(data.readings);

    chart.data.labels            = labels;
    chart.data.datasets[0].data  = diffs;
    chart.update('none');
  }

  // ── Fetch & poll ──────────────────────────────────────────────────────────

  async function fetchAndUpdate() {
    try {
      var res  = await fetch('/api/graph/' + GAME_UUID + '/data');
      var data = await res.json();

      document.getElementById('gameTitle').textContent =
        data.gameName ? data.gameName : GAME_UUID;

      updateChart(data);

      if (!data.active) {
        stopPoller();
        var badge = document.getElementById('statusBadge');
        badge.textContent = 'Finished';
        badge.className   = 'status-badge finished';
      }
    } catch (err) {
      console.error('[Graph] Fetch error:', err);
    }
  }

  // ── Smooth toggle link ────────────────────────────────────────────────────

  function buildSmoothToggle() {
    var el  = document.getElementById('smoothToggle');
    var url = new URL(window.location.href);
    if (SMOOTH) {
      url.searchParams.delete('smooth');
      el.innerHTML = 'Smoothed — <a href="' + url + '">Show raw</a>';
    } else {
      url.searchParams.set('smooth', '1');
      el.innerHTML = '<a href="' + url + '">Enable smoothing</a>';
    }
  }

  // ── Export link ───────────────────────────────────────────────────────────

  function buildExportLink() {
    var href = '/api/graph/' + GAME_UUID + '/export' + (SMOOTH ? '?smooth=1' : '');
    document.getElementById('exportLink').href = href;
  }

  // ── Unthrottled polling via Web Worker ───────────────────────────────────

  var poller = new Worker('/static/poll-worker.js');
  poller.onmessage = function (e) {
    if (e.data.type === 'tick') fetchAndUpdate();
  };

  function startPoller() { poller.postMessage({ type: 'start', intervalMs: POLL_MS }); }
  function stopPoller()  { poller.postMessage({ type: 'stop' }); poller.terminate(); }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') fetchAndUpdate();
  });

  // ── Boot ──────────────────────────────────────────────────────────────────

  initChart();
  buildSmoothToggle();
  buildExportLink();
  fetchAndUpdate();
  startPoller();
})();
