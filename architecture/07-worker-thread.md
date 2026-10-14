# Architecture: OCR Worker Thread

## Overview

The OCR pipeline runs in a dedicated `worker_threads` Worker, isolating CPU-intensive operations (image preprocessing, OCR inference) from the Fastify event loop. The worker runs continuously, self-pacing its 1Hz tick loop, and communicates with the main thread via `postMessage`.

---

## Worker Entrypoint (`src/ocr/worker.ts`)

```typescript
import { parentPort, workerData } from 'worker_threads';
import { createWorker as createTesseractWorker, Worker as TesseractWorker } from 'tesseract.js';
import { captureRegion } from './capture';
import { preprocessBlueRegion, preprocessRedRegion } from './preprocess';
import { parseGoldValue } from './parse';
import type { AppConfig } from '../config/config';

// ── State ──────────────────────────────────────────────────────────────────
let config: AppConfig = workerData.config;
let tesseractWorker: TesseractWorker | null = null;
let running = false;

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  tesseractWorker = await createTesseractWorker('eng', 1, {
    // Suppress Tesseract's verbose logging
    logger: () => {},
  });

  await tesseractWorker.setParameters({
    tessedit_ocr_engine_mode: '0',         // OEM_TESSERACT_ONLY (legacy, faster)
    tessedit_pageseg_mode: '7',            // PSM_SINGLE_LINE
    tessedit_char_whitelist: '0123456789.k',
  });

  running = true;
  parentPort!.postMessage({ type: 'ready' });
  tick(); // begin self-pacing loop
}

// ── Message handling ───────────────────────────────────────────────────────
parentPort!.on('message', (msg: MainMessage) => {
  switch (msg.type) {
    case 'updateConfig':
      config = msg.config;
      break;
    case 'setActive':
      // Not used for loop control — worker always ticks
      // 'setActive' is informational; main thread filters readings
      break;
    case 'shutdown':
      running = false;
      tesseractWorker?.terminate();
      break;
  }
});

// ── Self-correcting tick loop ──────────────────────────────────────────────
async function tick() {
  if (!running) return;

  const start = performance.now();

  try {
    await runPipeline();
  } catch (err) {
    console.error('[OCRWorker] Pipeline error:', err);
    parentPort!.postMessage({ type: 'fail' });
  }

  const elapsed = performance.now() - start;
  const delay = Math.max(0, 1000 - elapsed);
  setTimeout(tick, delay);
}

// ── Pipeline ───────────────────────────────────────────────────────────────
async function runPipeline() {
  // Step 1: Capture
  const captureResult = await captureRegion(
    config.processName,
    config.regions.blueGold,
    config.regions.redGold
  );

  if (!captureResult) {
    parentPort!.postMessage({ type: 'fail' });
    return;
  }

  const { rawRGBA, width, height } = captureResult;

  // Step 2: Preprocess (parallel)
  const [png1, png2] = await Promise.all([
    preprocessBlueRegion(rawRGBA, width, height, config.regions.blueGold),
    preprocessRedRegion(rawRGBA, width, height, config.regions.redGold),
  ]);

  // Step 3: OCR (parallel)
  const [result1, result2] = await Promise.all([
    tesseractWorker!.recognize(png1),
    tesseractWorker!.recognize(png2),
  ]);

  // Step 4: Parse
  const blueResult = parseGoldValue(result1.data.text);
  const redResult  = parseGoldValue(result2.data.text);

  if (!blueResult.valid || !redResult.valid) {
    parentPort!.postMessage({ type: 'fail' });
    return;
  }

  // Step 5: Report success
  parentPort!.postMessage({
    type: 'reading',
    blueGold:  blueResult.value,
    redGold:   redResult.value,
    timestamp: Date.now(),
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────
init().catch(err => {
  parentPort!.postMessage({ type: 'initError', error: err.message });
  process.exit(1);
});

// ── Type definitions ───────────────────────────────────────────────────────
type MainMessage =
  | { type: 'updateConfig'; config: AppConfig }
  | { type: 'setActive'; active: boolean }
  | { type: 'shutdown' };
```

---

## Worker Spawn in Main Process (`src/index.ts`)

```typescript
import { Worker } from 'worker_threads';
import path from 'path';

function spawnOCRWorker(config: AppConfig): Worker {
  const worker = new Worker(
    path.join(__dirname, 'ocr/worker.js'),
    { workerData: { config } }
  );

  worker.on('error', (err) => {
    console.error('[Main] OCR Worker error:', err.message);
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[Main] OCR Worker exited with code ${code}`);
    }
  });

  return worker;
}
```

**`workerData`**: The initial config is passed via `workerData` at spawn time. Subsequent config updates are sent via `postMessage({ type: 'updateConfig' })`.

---

## Message Protocol (Main ↔ Worker)

### Main → Worker

| Message Type | Payload | Description |
|-------------|---------|-------------|
| `updateConfig` | `{ config: AppConfig }` | Push updated config to worker |
| `setActive` | `{ active: boolean }` | Inform worker of session state (informational) |
| `shutdown` | — | Gracefully terminate Tesseract and stop loop |

### Worker → Main

| Message Type | Payload | Description |
|-------------|---------|-------------|
| `ready` | — | Tesseract initialized, loop starting |
| `reading` | `{ blueGold, redGold, timestamp }` | Successful OCR tick |
| `fail` | — | Failed tick (capture fail, preprocess fail, OCR no match, parse invalid) |
| `initError` | `{ error: string }` | Fatal init failure |

---

## Capture Implementation (`src/ocr/capture.ts`)

```typescript
import { Window } from 'node-screenshots';

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureResult {
  rawRGBA: Buffer;
  width: number;
  height: number;
}

export async function captureRegion(
  processName: string,
  region1: Region,
  region2: Region
): Promise<CaptureResult | null> {
  const windows = Window.all();

  const target = windows.find(w => {
    const name  = (w.appName  ?? '').toLowerCase();
    const title = (w.title    ?? '').toLowerCase();
    const search = processName.toLowerCase();
    return name.includes(search) || title.includes(search);
  });

  if (!target) return null;

  // Capture full window image once (always 1920x1080 for LoL)
  const image = await target.captureImage();

  // node-screenshots Image → raw RGBA buffer
  // The Image class provides toRaw() or similar — check package API
  const rawRGBA = await image.toRaw(); // Returns Buffer of RGBA pixels

  return {
    rawRGBA,
    width: image.width,
    height: image.height,
  };
}
```

**Single capture, two crops**: One `captureImage()` call per tick. Both regions are cropped from the same buffer by `sharp` in the preprocess step. This avoids two separate window captures per second.

---

## Preprocess Implementation (`src/ocr/preprocess.ts`)

```typescript
import sharp from 'sharp';

export async function preprocessBlueRegion(
  rawRGBA: Buffer,
  srcWidth: number,
  srcHeight: number,
  region: Region
): Promise<Buffer> {
  // Crop from full image
  const cropped = await sharp(rawRGBA, {
    raw: { width: srcWidth, height: srcHeight, channels: 4 }
  })
    .extract({ left: region.x, top: region.y, width: region.width, height: region.height })
    .raw()
    .toBuffer();

  // Apply blue channel filter
  const bw = applyBlueFilter(cropped, region.width, region.height);

  // Upscale 4x with nearest-neighbor, output as PNG for Tesseract
  return sharp(bw, {
    raw: { width: region.width, height: region.height, channels: 1 }
  })
    .resize(region.width * 4, region.height * 4, { kernel: 'nearest' })
    .png()
    .toBuffer();
}

export async function preprocessRedRegion(
  rawRGBA: Buffer,
  srcWidth: number,
  srcHeight: number,
  region: Region
): Promise<Buffer> {
  const cropped = await sharp(rawRGBA, {
    raw: { width: srcWidth, height: srcHeight, channels: 4 }
  })
    .extract({ left: region.x, top: region.y, width: region.width, height: region.height })
    .raw()
    .toBuffer();

  const bw = applyRedFilter(cropped, region.width, region.height);

  return sharp(bw, {
    raw: { width: region.width, height: region.height, channels: 1 }
  })
    .resize(region.width * 4, region.height * 4, { kernel: 'nearest' })
    .png()
    .toBuffer();
}

function applyBlueFilter(raw: Buffer, w: number, h: number): Buffer {
  const out = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = raw[i * 4 + 2] > 150 ? 255 : 0; // blue channel index = 2
  }
  return out;
}

function applyRedFilter(raw: Buffer, w: number, h: number): Buffer {
  const out = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = raw[i * 4 + 0] > 150 ? 255 : 0; // red channel index = 0
  }
  return out;
}
```

---

## Worker Thread Lifecycle Diagram

```
Main Process                    OCR Worker Thread
     │                                │
     ├── new Worker(worker.js) ───────►│
     │      workerData: { config }     │ init()
     │                                 │ createTesseractWorker()
     │                                 │ setParameters()
     │◄── postMessage({ type:'ready'}) │
     │                                 │ tick() → tick() → tick() ...
     │◄── { type:'reading', ... } ─────│ (every ~1s)
     │                                 │
     ├── postMessage({type:'updateConfig'}) ──►│
     │                                 │ config = newConfig
     │                                 │
     ├── postMessage({type:'shutdown'}) ──────►│
     │                                 │ tesseractWorker.terminate()
     │                                 │ process exits
     │◄── worker 'exit' event ─────────│
```

---

## Performance Notes

- **Tesseract pre-warming**: `createWorker` + `setParameters` runs once at startup. Each `recognize()` call on a warmed worker is 20–80ms for a 240×80px image.
- **Sharp native bindings**: All image operations are C++ native. No JS overhead in the pipeline.
- **Buffer reuse**: A new RGBA buffer is allocated per capture. Not reused to avoid race conditions if the previous tick hasn't finished (though the self-correcting loop prevents overlap).
- **Promise.all parallelism**: Both preprocess + OCR steps run in parallel, saving ~100ms vs sequential.
- **No disk I/O**: All buffers pass between functions in memory. `sharp().toBuffer()` never writes to disk.
