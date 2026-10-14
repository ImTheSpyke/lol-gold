export interface ParseResult {
  value: number;
  raw:   string;
  valid: boolean;
}

const MAX_GOLD = 200;

const GOLD_PATTERN_GLOBAL = /(\d+[.,]\d+)k/gi;

export function parseGoldValue(ocrText: string): ParseResult {
  const clean   = ocrText.trim().toLowerCase().replace(/\s+/g, '');
  const matches = [...clean.matchAll(GOLD_PATTERN_GLOBAL)];

  if (!matches.length) return { value: 0, raw: ocrText, valid: false };

  // When Tesseract hallucinates a leading digit (e.g. "658.0k" instead of "68.0k"),
  // the real value is the rightmost match within the valid gold range.
  for (let i = matches.length - 1; i >= 0; i--) {
    const normalized = matches[i][1].replace(',', '.');
    const numeric    = parseFloat(normalized);
    if (!isNaN(numeric) && numeric > 0 && numeric <= MAX_GOLD) {
      return { value: numeric, raw: matches[i][0], valid: true };
    }
  }

  return { value: 0, raw: ocrText, valid: false };
}
