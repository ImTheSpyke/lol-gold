# Architecture: OCR Pipeline

## Overview

The OCR pipeline runs inside a dedicated `worker_threads` Worker at 1Hz. It performs four sequential steps per tick: capture, preprocess, recognize, parse. The entire pipeline must complete within 300ms to maintain the 1-second interval without drift.

---

## Step 1 — Screen Capture (`src/ocr/capture.ts`)

### Library: `node-screenshots`

`node-screenshots` enumerates all open windows and can capture by process name or window title. It supports sub-region capture natively.

```typescript
import { Window } from 'node-screenshots';

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function captureRegion(
  processName: string,
  region: Region
): Promise<Buffer | null> {
  const windows = Window.all();
  const target = windows.find(w =>
    w.appName?.toLowerCase().includes(processName.toLowerCase()) ||
    w.title?.toLowerCase().includes(processName.toLowerCase())
  );

  if (!target) return null;

  // node-screenshots captures the full window; we crop via sharp
  // OR use the captureArea API if available on the installed version
  const screenshot = await target.captureImage();
  return screenshot.toRawBuffer(); // returns raw RGBA buffer
}
```

**Important**: `node-screenshots` returns RGBA raw pixel data. The returned buffer is passed directly to `sharp` for preprocessing. No disk I/O at any point — everything stays in memory.

**Process matching**: Match is case-insensitive substring on both `appName` and `title`. Default: `"League Of Legends"`. Configurable in dashboard.

**Window not found**: Return `null` → counts as OCR fail in session manager.

**Expected window resolution**: Always 1920×1080. The game must be running in windowed or borderless windowed mode. Fullscreen exclusive may prevent capture — document this limitation.

---

## Step 2 — Preprocessing (`src/ocr/preprocess.ts`)

### Library: `sharp`

Sharp processes the raw RGBA buffer in-memory with no temp files. Two separate pipelines run for the two regions.

```
Default regions:
  Region 1 (blue_gold):  { x: 798, y: 17, w: 60, h: 20 }
  Region 2 (red_gold):   { x: 1103, y: 18, w: 60, h: 20 }
```

### Pipeline

```typescript
import sharp from 'sharp';

export async function preprocessBlueRegion(
  rawRGBA: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  region: Region
): Promise<Buffer> {
  return sharp(rawRGBA, {
    raw: { width: sourceWidth, height: sourceHeight, channels: 4 }
  })
    .extract({ left: region.x, top: region.y, width: region.width, height: region.height })
    .raw()
    .toBuffer()
    .then(cropped => applyBlueFilter(cropped, region.width, region.height))
    .then(bw => sharp(bw, { raw: { width: region.width, height: region.height, channels: 1 } })
      .resize(region.width * 4, region.height * 4, { kernel: 'nearest' })
      .png()
      .toBuffer()
    );
}
```

### Pixel Filter Logic

The filter is applied on raw RGBA pixel data via a tight JS loop. For 60×20×4 = 4800 bytes this is negligible CPU cost.

**Region 1 — Blue Gold Filter**:
```typescript
function applyBlueFilter(raw: Buffer, w: number, h: number): Buffer {
  const out = Buffer.alloc(w * h); // grayscale output
  for (let i = 0; i < w * h; i++) {
    const b = raw[i * 4 + 2]; // blue channel (RGBA)
    out[i] = b > 150 ? 255 : 0; // white if blue > 150, else black
  }
  return out;
}
```

**Region 2 — Red Gold Filter**:
```typescript
function applyRedFilter(raw: Buffer, w: number, h: number): Buffer {
  const out = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = raw[i * 4 + 0]; // red channel
    out[i] = r > 150 ? 255 : 0;
  }
  return out;
}
```

### 4x Upscale

After filtering, the 60×20 B&W image is upscaled to 240×80 using nearest-neighbor interpolation. This is critical for Tesseract accuracy on small text — Tesseract's internal neural network expects a minimum character height of ~20px. At 13px native, upscaling to 52px (4x) puts characters well within reliable recognition range.

```
60×20 → filter → grayscale 60×20 → nearest-neighbor 4x → 240×80 PNG in memory
```

### Output

PNG buffer in memory, white text on black background. Ready for OCR.

---

## Step 3 — OCR Recognition

### Engine: `tesseract.js` v5

**Configuration**:
```typescript
import { createWorker } from 'tesseract.js';

const worker = await createWorker('eng', 1, {
  // OEM 0 = Legacy engine only (faster than LSTM for digit+k patterns)
  // PSM 7 = Treat image as a single text line
});

await worker.setParameters({
  tessedit_ocr_engine_mode: '0',     // OEM_TESSERACT_ONLY
  tessedit_pageseg_mode: '7',        // PSM_SINGLE_LINE
  tessedit_char_whitelist: '0123456789.k',
});
```

**Worker lifecycle**: The Tesseract worker is initialized **once** when the OCR worker thread starts, then reused for every tick. Initialization takes ~1-2 seconds (acceptable at startup). Each `recognize()` call on a pre-warmed worker with a 240×80px PNG should take 20–80ms.

**Parallelism**: Both regions are recognized concurrently:
```typescript
const [result1, result2] = await Promise.all([
  worker.recognize(region1Buffer),
  worker.recognize(region2Buffer),
]);
```

This keeps both OCR calls within the same ~80ms window rather than sequential ~160ms.

**If tesseract.js exceeds 0.3s budget**: Replace with a compiled native binding. The pipeline interface (`recognize(buffer): Promise<string>`) is abstracted in `src/ocr/engine.ts` so swapping engines requires only one file change.

```typescript
// src/ocr/engine.ts — engine abstraction interface
export interface OCREngine {
  init(): Promise<void>;
  recognize(imageBuffer: Buffer): Promise<string>;
  destroy(): Promise<void>;
}
```

---

## Step 4 — Parsing (`src/ocr/parse.ts`)

```typescript
const GOLD_PATTERN = /(\d+\.\d+)k/i;

export interface ParseResult {
  value: number;    // e.g. 12500 (stored as float: 12.5 → 12500 would be up to caller)
  raw: string;      // e.g. "12.5k"
  valid: boolean;
}

export function parseGoldValue(ocrText: string): ParseResult {
  const clean = ocrText.trim().toLowerCase().replace(/\s+/g, '');
  const match = clean.match(GOLD_PATTERN);

  if (!match) return { value: 0, raw: ocrText, valid: false };

  const numeric = parseFloat(match[1]); // e.g. 12.5
  return { value: numeric, raw: match[0], valid: true };
}
```

**Storage format**: `blue_gold` and `red_gold` are stored as `DECIMAL(8,1)` in MariaDB. The value `12.5k` is stored as `12.5` (the "k" is implicit — the application layer always multiplies by 1000 when computing gold difference for the graph). This avoids float imprecision and keeps the stored value human-readable.

**Validation rule**: Both regions must produce a valid match for the tick to count as a successful reading. A partial success (one valid, one invalid) counts as a fail.

---

## Complete Tick Sequence

```
[Worker tick — 1000ms interval]
    │
    ├── 1. captureRegion(processName, fullWindow) → rawRGBA Buffer
    │         └── null? → postMessage({ type: 'fail' }) → return
    │
    ├── 2. Promise.all([
    │       preprocessBlue(rawRGBA, region1),
    │       preprocessRed(rawRGBA, region2)
    │   ]) → [png1, png2]
    │
    ├── 3. Promise.all([
    │       worker.recognize(png1),
    │       worker.recognize(png2)
    │   ]) → [text1, text2]
    │
    ├── 4. parseGoldValue(text1) + parseGoldValue(text2)
    │         └── either invalid? → postMessage({ type: 'fail' }) → return
    │
    └── 5. postMessage({
              type: 'reading',
              blueGold: result1.value,
              redGold: result2.value,
              timestamp: Date.now()
            })
```

---

## Timing Budget Analysis

| Step | Expected | Worst Case |
|------|----------|------------|
| Window enumeration + capture | 20ms | 60ms |
| sharp extract + filter (×2, parallel) | 5ms | 15ms |
| sharp upscale + PNG encode (×2) | 5ms | 15ms |
| Tesseract recognize (×2, parallel) | 60ms | 180ms |
| Parse + message overhead | 1ms | 2ms |
| **Total** | **91ms** | **272ms** |

All within 300ms budget. The interval timer in the worker must use a **self-correcting interval** that subtracts elapsed time to prevent drift:

```typescript
async function tick() {
  const start = performance.now();
  await runPipeline();
  const elapsed = performance.now() - start;
  const delay = Math.max(0, 1000 - elapsed);
  setTimeout(tick, delay);
}
```

---

## Edge Cases

| Case | Handling |
|------|----------|
| LoL not running | `captureRegion` returns null → fail |
| LoL minimized | Some capture APIs return blank buffer → OCR produces no match → fail |
| Anti-cheat blocks capture | null or empty buffer → fail |
| OCR misreads `.` as `,` | Regex handles both: `/(\d+[.,]\d+)k/i` with normalization |
| Partial character glitch (1-3px) | Upscaling + Tesseract tolerance handles minor noise |
| Two workers tick simultaneously | Single worker thread, sequential — impossible |
| Tesseract worker crashes | Main thread catches `worker.error` event, respawns worker, logs critical |
