import type { ChartConfiguration, Plugin } from 'chart.js';
import type { GraphPoint } from './readings';
import { gaussianSmooth } from './smoothing';

const WIDTH  = 1200;
const HEIGHT = 400;

const background: Plugin = {
  id: 'background',
  beforeDraw(chart) {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};

async function render(configuration: ChartConfiguration): Promise<Buffer> {
  // Lazy-loaded: native modules are only needed when a PNG is actually requested.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createCanvas } = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Chart, registerables } = require('chart.js') as typeof import('chart.js');
  Chart.register(...registerables);

  const canvas = createCanvas(WIDTH, HEIGHT);
  // Chart.js only needs a canvas-like with a style object outside the DOM.
  Object.assign(canvas, { style: {} });
  const chart = new Chart(canvas as unknown as HTMLCanvasElement, {
    ...configuration,
    plugins: [background],
  });
  try {
    return await canvas.encode('png');
  } finally {
    chart.destroy();
  }
}

export async function exportToPNG(readings: Pick<GraphPoint, 't' | 'diff'>[], smooth: boolean): Promise<Buffer> {
  const rawDiffs = readings.map(r => r.diff);
  const diffs    = smooth ? gaussianSmooth(rawDiffs) : rawDiffs;
  const points   = readings.map((r, i) => ({ x: r.t / 60, y: diffs[i] ?? 0 }));

  const maxAbs = Math.max(5, ...diffs.map(Math.abs));
  const yRange = maxAbs + 1;

  const configuration: ChartConfiguration = {
    type: 'line',
    data: {
      datasets: [
        {
          label:       'Gold Difference',
          data:        points,
          borderWidth: 2,
          pointRadius: 0,
          tension:     0,
          fill:        {
            target: { value: 0 },
            above:  'rgba(59,130,246,0.2)',
            below:  'rgba(239,68,68,0.2)',
          },
          segment: {
            borderColor: (ctx) =>
              (ctx.p0.parsed.y ?? 0) >= 0 ? '#3b82f6' : '#ef4444',
          },
        },
      ],
    },
    options: {
      responsive:          false,
      animation:           false,
      maintainAspectRatio: false,
      scales: {
        x: {
          type:  'linear',
          min:   0,
          max:   points.length ? points[points.length - 1]!.x : undefined,
          ticks: {
            stepSize:      5,
            includeBounds: false,
            color:         '#94a3b8',
            callback:      (v) => `${v}min`,
          },
          grid: { color: '#1e293b' },
        },
        y: {
          min: -yRange,
          max:  yRange,
          ticks: {
            color: '#94a3b8',
            callback: (v) => `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)}k`,
          },
          grid: { color: '#1e293b' },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  };

  return render(configuration);
}
