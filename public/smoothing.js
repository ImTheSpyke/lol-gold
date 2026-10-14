/* Gaussian-weighted moving average shared by the graph and widget pages.
   Mirrors src/graph/smoothing.ts (used for the PNG export). */
(function () {
  'use strict';

  function buildGaussianKernel(size, sigma) {
    var half   = Math.floor(size / 2);
    var kernel = [];
    var sum    = 0;
    for (var i = 0; i < size; i++) {
      var x   = i - half;
      var val = Math.exp(-(x * x) / (2 * sigma * sigma));
      kernel.push(val);
      sum += val;
    }
    return kernel.map(function (v) { return v / sum; });
  }

  window.gaussianSmooth = function (data, windowSize, sigma) {
    windowSize = windowSize || 15;
    sigma      = sigma      || 5;
    if (!data.length) return [];
    var kernel = buildGaussianKernel(windowSize, sigma);
    var halfW  = Math.floor(windowSize / 2);
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
  };
})();
