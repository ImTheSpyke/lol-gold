import type { ChartConfiguration } from 'chart.js';
import type { GraphPoint } from './readings';
import { gaussianSmooth } from './smoothing';

let renderer: import('chartjs-node-canvas').ChartJSNodeCanvas | null = null;

function getRenderer(): import('chartjs-node-canvas').ChartJSNodeCanvas {
  if (!renderer) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ChartJSNodeCanvas } = require('chartjs-node-canvas') as typeof import('chartjs-node-canvas');
    renderer = new ChartJSNodeCanvas({ width: 1200, height: 400, backgroundColour: '#0f172a' });
  }
  return renderer;
}

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}min`;
}

export async function exportToPNG(readings: Pick<GraphPoint, 't' | 'diff'>[], smooth: boolean): Promise<Buffer> {
  const rawDiffs = readings.map(r => r.diff);
  const diffs    = smooth ? gaussianSmooth(rawDiffs) : rawDiffs;
  const labels   = readings.map(r => formatTime(r.t));

  const maxAbs = Math.max(5, ...diffs.map(Math.abs));
  const yRange = maxAbs + 1;

  const configuration: ChartConfiguration = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label:       'Gold Difference',
          data:        diffs,
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
          type:  'category',
          ticks: {
            maxTicksLimit: 12,
            autoSkip:      true,
            color:         '#94a3b8',
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

  return getRenderer().renderToBuffer(configuration);
}
