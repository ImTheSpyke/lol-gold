function buildGaussianKernel(size: number, sigma: number): number[] {
  const half   = Math.floor(size / 2);
  const kernel: number[] = [];
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x   = i - half;
    const val = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel.push(val);
    sum += val;
  }
  return kernel.map(v => v / sum);
}

/**
 * Gaussian-weighted moving average. Edges renormalize over the in-range part
 * of the kernel. Mirrors the client-side implementation in public/graph.js.
 */
export function gaussianSmooth(data: number[], windowSize = 15, sigma = 5): number[] {
  if (data.length === 0) return [];
  const kernel = buildGaussianKernel(windowSize, sigma);
  const halfW  = Math.floor(windowSize / 2);

  return data.map((_, i) => {
    let weightedSum = 0;
    let weightTotal = 0;
    for (let j = 0; j < windowSize; j++) {
      const idx = i - halfW + j;
      if (idx < 0 || idx >= data.length) continue;
      weightedSum += data[idx] * kernel[j];
      weightTotal += kernel[j];
    }
    return weightTotal > 0 ? weightedSum / weightTotal : 0;
  });
}
