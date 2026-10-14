import { gaussianSmooth } from '../src/export/png';

describe('gaussianSmooth', () => {
  test('returns empty array for empty input', () => {
    expect(gaussianSmooth([])).toEqual([]);
  });

  test('returns single-element array unchanged', () => {
    const result = gaussianSmooth([5.0]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeCloseTo(5.0);
  });

  test('smoothed output has same length as input', () => {
    const data = [1, 5, 2, 8, 1, 3, 9, 2, 4, 1];
    expect(gaussianSmooth(data)).toHaveLength(data.length);
  });

  test('flat signal passes through unchanged', () => {
    const data   = Array(20).fill(3.0);
    const result = gaussianSmooth(data);
    result.forEach(v => expect(v).toBeCloseTo(3.0, 5));
  });

  test('single spike is attenuated', () => {
    const data    = Array(20).fill(0);
    data[10]      = 100;
    const result  = gaussianSmooth(data);
    // The spike at index 10 should be smoothed down significantly
    expect(result[10]).toBeLessThan(100);
    expect(result[10]).toBeGreaterThan(0);
    // Neighbors should pick up some of the value
    expect(result[9]).toBeGreaterThan(0);
    expect(result[11]).toBeGreaterThan(0);
  });

  test('preserves general trend direction', () => {
    // Rising sequence — smoothed should still be generally rising
    const data   = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = gaussianSmooth(data);
    expect(result[result.length - 1]).toBeGreaterThan(result[0]);
  });

  test('handles negative values correctly', () => {
    const data   = [-5, -5, -5, -5, -5];
    const result = gaussianSmooth(data);
    result.forEach(v => expect(v).toBeCloseTo(-5.0, 4));
  });
});
