# Architecture: Graph System

## Overview

The graph renders gold difference (`blue_gold - red_gold`) over time for a single game. It runs client-side using Chart.js, polls for new data every 60 seconds while the game is active, and stops polling when the game ends. PNG export is rendered server-side using `chartjs-node-canvas` with the same configuration.

---

## Data API

### `GET /api/graph/:gameUUID/data`

Returns all readings for a game, pre-computed for graph consumption:

```typescript
// Response shape
interface GraphDataResponse {
  gameUUID: string;
  gameName: string | null;
  active: boolean;           // true = session currently writing to this UUID
  startTime: string | null;  // ISO 8601, timestamp of first reading
  readings: GraphPoint[];
}

interface GraphPoint {
  t: number;     // seconds elapsed since startTime
  diff: number;  // blue_gold - red_gold (in k units, e.g. 2.7 = 2.7k)
}
```

**Server-side computation**:
```typescript
// In graphData route handler
const rows = await getGraphData(gameUUID);
if (!rows.length) return reply.send({ readings: [], active: false, startTime: null });

const startMs = rows[0].recorded_at.getTime();
const readings: GraphPoint[] = rows.map(row => ({
  t: (row.recorded_at.getTime() - startMs) / 1000,
  diff: parseFloat(row.blue_gold) - parseFloat(row.red_gold),
}));
```

**Why send raw diff**: Keeps the API simple. The client receives `diff` directly and renders it. Smoothing is applied client-side by a JS function before rendering.

---

## Client-Side Graph (`src/server/static/graph.js`)

### Chart.js Configuration

```javascript
const ctx = document.getElementById('goldChart').getContext('2d');

const chart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: [],     // filled with formatted time strings ("10min", "20min")
    datasets: [{
      label: 'Gold Difference',
      data: [],     // filled with diff values
      borderColor: createGradient(ctx),
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0,   // no Chart.js smoothing — we do it ourselves
      fill: {
        target: { value: 0 },
        above: 'rgba(59, 130, 246, 0.15)',  // blue fill above 0
        below: 'rgba(239, 68, 68, 0.15)',   // red fill below 0
      },
      segment: {
        borderColor: ctx => ctx.p0.parsed.y >= 0 ? '#3b82f6' : '#ef4444',
      },
    }]
  },
  options: {
    responsive: false,           // fixed dimensions
    animation: false,            // no animation on poll updates
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'category',
        ticks: {
          maxTicksLimit: 12,     // max ~12 labels regardless of data density
          autoSkip: true,
        }
      },
      y: {
        min: -5,                 // default ±5k (in k units)
        max: 5,
        afterDataLimits(scale) {
          // Expand dynamically if data exceeds bounds
          const pad = 1; // 1k padding
          if (scale.max < 5) scale.max = 5;
          if (scale.min > -5) scale.min = -5;
          scale.max += pad;
          scale.min -= pad;
        }
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: ctx => `${ctx.parsed.y > 0 ? '+' : ''}${ctx.parsed.y.toFixed(1)}k`,
          title: ctx => formatTime(ctx[0].parsed.x),
        }
      }
    }
  }
});
```

### Fixed Canvas Dimensions

The canvas is fixed at **1200×400px** (configurable via CSS variables but not responsive):
```html
<canvas id="goldChart" width="1200" height="400"></canvas>
```

Chart.js renders data into this fixed space. All data is compressed horizontally to fit — Chart.js handles this automatically when `maxTicksLimit` is set and `autoSkip: true`.

### X-Axis Label Formatting

```javascript
function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}min`;
}

// Labels are generated from t values
function buildLabels(readings) {
  return readings.map(r => formatTime(r.t));
}
```

Labels auto-skip via Chart.js when data is dense. With 7200 points and `maxTicksLimit: 12`, labels appear approximately every 10 minutes.

---

## Smoothing Algorithm (`?smooth=1`)

When `?smooth=1` is in the URL, apply a **weighted rolling average** before rendering. The algorithm must smooth small peaks while preserving the general shape:

**Gaussian-weighted moving average** (window=15 points, σ=5):

```javascript
function gaussianSmooth(data, windowSize = 15, sigma = 5) {
  const kernel = buildGaussianKernel(windowSize, sigma);
  const halfW = Math.floor(windowSize / 2);

  return data.map((_, i) => {
    let weightedSum = 0;
    let weightTotal = 0;

    for (let j = 0; j < windowSize; j++) {
      const dataIdx = i - halfW + j;
      if (dataIdx < 0 || dataIdx >= data.length) continue;
      weightedSum += data[dataIdx] * kernel[j];
      weightTotal += kernel[j];
    }

    return weightedSum / weightTotal;
  });
}

function buildGaussianKernel(size, sigma) {
  const half = Math.floor(size / 2);
  const kernel = [];
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - half;
    const val = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel.push(val);
    sum += val;
  }
  return kernel.map(v => v / sum); // normalize
}
```

**Why Gaussian over simple moving average**: A Gaussian kernel gives more weight to nearby points and less to distant ones, producing smoother curves without the "box" artifact of SMA. It eliminates 1-3 point spike noise (the OCR misread glitches) while preserving sustained trends.

**Applied to**:
```javascript
const rawDiffs = readings.map(r => r.diff);
const smoothed = smooth ? gaussianSmooth(rawDiffs) : rawDiffs;
```

---

## Polling Logic

```javascript
const POLL_INTERVAL = 60000; // 60 seconds

async function fetchAndUpdate() {
  const res = await fetch(`/api/graph/${gameUUID}/data`);
  const data = await res.json();

  const diffs = smooth
    ? gaussianSmooth(data.readings.map(r => r.diff))
    : data.readings.map(r => r.diff);

  chart.data.labels = buildLabels(data.readings);
  chart.data.datasets[0].data = diffs;
  chart.update('none'); // 'none' = no animation

  // Stop polling when game is no longer active
  if (!data.active) {
    clearInterval(pollTimer);
    document.getElementById('statusBadge').textContent = 'Finished';
  }
}

// Initial load
fetchAndUpdate();

// Start polling
const pollTimer = setInterval(fetchAndUpdate, POLL_INTERVAL);
```

**Why HTTP polling over WebSocket**: The graph updates every 60 seconds. WebSocket adds complexity for marginal benefit at this refresh rate. HTTP polling also correctly handles both live and historical game states without special-casing.

---

## PNG Export (`src/export/png.ts`)

Uses `chartjs-node-canvas` to render the same chart configuration server-side:

```typescript
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';

const canvasRenderer = new ChartJSNodeCanvas({
  width: 1200,
  height: 400,
  backgroundColour: '#0f172a', // dark background
});

export async function exportToPNG(
  readings: GraphPoint[],
  smooth: boolean
): Promise<Buffer> {
  const diffs = smooth ? gaussianSmooth(readings.map(r => r.diff)) : readings.map(r => r.diff);
  const labels = readings.map(r => formatTime(r.t));

  const configuration = {
    type: 'line' as const,
    data: {
      labels,
      datasets: [{
        data: diffs,
        borderColor: diffs.map(d => d >= 0 ? '#3b82f6' : '#ef4444'),
        // ... same config as client-side
      }]
    },
    options: { /* same as client */ }
  };

  return canvasRenderer.renderToBuffer(configuration);
}
```

**Route handler**:
```typescript
app.get('/api/graph/:gameUUID/export', async (req, reply) => {
  const { gameUUID } = req.params as { gameUUID: string };
  const smooth = (req.query as any).smooth === '1';

  const data = await getGraphDataForExport(gameUUID);
  if (!data) return reply.status(404).send({ error: 'Game not found' });
  if (!data.readings.length) return reply.status(204).send();

  const png = await exportToPNG(data.readings, smooth);

  reply
    .header('Content-Type', 'image/png')
    .header('Content-Disposition', `attachment; filename="gold-${gameUUID}.png"`)
    .send(png);
});
```

**Performance note**: `chartjs-node-canvas` uses node-canvas (Cairo) which is CPU-bound. A 1200×400 chart renders in ~100-300ms. This is acceptable for on-demand export. No caching needed given the low frequency of export requests.

---

## Graph Page HTML Structure

```html
<!DOCTYPE html>
<html>
<head>
  <title>Gold Graph — <%= gameUUID %></title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
</head>
<body>
  <div id="app" data-game-uuid="<INJECTED>" data-smooth="<0|1>">
    <header>
      <a href="/recent">← Recent Games</a>
      <h1 id="gameTitle">Loading...</h1>
      <span id="statusBadge">Live</span>
      <a id="exportLink" href="#">Export PNG</a>
    </header>

    <div class="chart-container">
      <canvas id="goldChart" width="1200" height="400"></canvas>
    </div>

    <div class="legend">
      <span class="blue">■ Blue Team Ahead</span>
      <span class="red">■ Red Team Ahead</span>
    </div>
  </div>
  <script src="/static/graph.js"></script>
</body>
</html>
```

The `data-game-uuid` and `data-smooth` attributes are injected by the Fastify route handler when serving the HTML. The page is otherwise fully static.

**How Fastify injects values**: The route handler reads the HTML template file and does a string replacement on placeholder tokens before sending:
```typescript
app.get('/graph/:gameUUID', async (req, reply) => {
  const { gameUUID } = req.params as { gameUUID: string };
  const smooth = (req.query as any).smooth === '1' ? '1' : '0';
  let html = await fs.readFile(graphHtmlPath, 'utf-8');
  html = html.replace('<INJECTED>', gameUUID).replace('<0|1>', smooth);
  reply.header('Content-Type', 'text/html').send(html);
});
```
