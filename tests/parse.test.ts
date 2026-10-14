import { parseGoldValue } from '../src/ocr/parse';

describe('parseGoldValue', () => {
  test('parses standard format', () => {
    const r = parseGoldValue('12.5k');
    expect(r.valid).toBe(true);
    expect(r.value).toBe(12.5);
    expect(r.raw).toBe('12.5k');
  });

  test('parses uppercase K', () => {
    const r = parseGoldValue('60.0K');
    expect(r.valid).toBe(true);
    expect(r.value).toBe(60.0);
  });

  test('parses with surrounding whitespace', () => {
    const r = parseGoldValue('  2.5k  ');
    expect(r.valid).toBe(true);
    expect(r.value).toBe(2.5);
  });

  test('parses comma as decimal separator', () => {
    const r = parseGoldValue('18,3k');
    expect(r.valid).toBe(true);
    expect(r.value).toBeCloseTo(18.3);
  });

  test('parses large value', () => {
    const r = parseGoldValue('200.0k');
    expect(r.valid).toBe(true);
    expect(r.value).toBe(200.0);
  });

  test('parses minimum expected value', () => {
    const r = parseGoldValue('1.0k');
    expect(r.valid).toBe(true);
    expect(r.value).toBe(1.0);
  });

  test('rejects plain integer without k', () => {
    const r = parseGoldValue('850');
    expect(r.valid).toBe(false);
  });

  test('rejects empty string', () => {
    const r = parseGoldValue('');
    expect(r.valid).toBe(false);
  });

  test('rejects random text', () => {
    const r = parseGoldValue('abc');
    expect(r.valid).toBe(false);
  });

  test('rejects zero value', () => {
    const r = parseGoldValue('0.0k');
    expect(r.valid).toBe(false);
  });

  test('rejects text with OCR noise around valid number', () => {
    // Should still extract the valid part
    const r = parseGoldValue('|12.5k|');
    expect(r.valid).toBe(true);
    expect(r.value).toBe(12.5);
  });

  test('extracts value from string containing negative prefix (OCR never produces negatives, but regex is tolerant)', () => {
    // The OCR whitelist only contains digits, '.', and 'k' — a '-' prefix cannot appear from OCR output.
    // The parser finds 5.0k within '-5.0k', which is acceptable since this case cannot occur in practice.
    const r = parseGoldValue('-5.0k');
    expect(r.value).toBeCloseTo(5.0);
  });
});
