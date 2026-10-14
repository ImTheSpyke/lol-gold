/* Linear time-axis helpers shared by the graph and widget pages.
   Mirrors the x-axis setup in src/graph/export.ts (used for the PNG export). */
(function () {
  'use strict';

  // Load readings into the chart on a linear x-axis measured in minutes. The axis
  // ends at the latest reading so the newest data is always flush with the right edge.
  function setTimeSeries(chart, readings, diffs) {
    var points = readings.map(function (r, i) { return { x: r.t / 60, y: diffs[i] }; });
    chart.data.datasets[0].data = points;
    chart.options.scales.x.max  = points.length ? points[points.length - 1].x : undefined;
  }

  // Tick label for the x-axis, e.g. 5 -> "5min".
  function formatMinutes(v) {
    return v + 'min';
  }

  // Tooltip title for an x value in minutes, e.g. 12.5 -> "12:30".
  function formatClock(minutes) {
    var total = Math.floor(minutes * 60);
    var s     = total % 60;
    return Math.floor(total / 60) + ':' + (s < 10 ? '0' : '') + s;
  }

  window.setTimeSeries = setTimeSeries;
  window.formatMinutes = formatMinutes;
  window.formatClock   = formatClock;
})();
