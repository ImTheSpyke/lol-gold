import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { captureWindowRegion } from './capture';
import { preprocessRegion } from './preprocess';
import { parseGoldValue } from './parse';
import type { WorkerInMessage, WorkerOutMessage } from './messages';
import type { AppConfig } from '../config/config';

let config: AppConfig = workerData.config as AppConfig;

function post(msg: WorkerOutMessage): void {
  parentPort!.postMessage(msg);
}

// The project compiles to CommonJS, where TypeScript rewrites `import()` into
// `require()` — which cannot load the ESM-only PaddleOCR packages.
const esmImport = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;

parentPort!.on('message', (msg: WorkerInMessage) => {
  if (msg.type === 'updateConfig') config = msg.config;
});

process.on('uncaughtException', (err) => {
  console.error('[OCR Worker] Uncaught exception:', err);
  try { post({ type: 'initError', error: String(err) }); } catch {}
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[OCR Worker] Unhandled rejection:', reason);
  try { post({ type: 'initError', error: String(reason) }); } catch {}
  process.exit(1);
});

// ── PaddleOCR ─────────────────────────────────────────────────────────────────

let ocr:            import('ppu-paddle-ocr').PaddleOcrService | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let CanvasProcessor: { prepareCanvas(buf: ArrayBuffer): Promise<any> } | null = null;

async function init(): Promise<void> {
  const { PaddleOcrService } = await esmImport('ppu-paddle-ocr') as typeof import('ppu-paddle-ocr');
  const ppuCanvas = await esmImport('ppu-ocv/canvas') as { CanvasProcessor: { prepareCanvas(buf: ArrayBuffer): Promise<any> } };
  CanvasProcessor = ppuCanvas.CanvasProcessor;

  ocr = new PaddleOcrService({
    processing: { engine: 'canvas-native' },
    detection:  { minimumAreaThreshold: 5, paddingVertical: 0.1, paddingHorizontal: 0.1 },
    session:    { executionProviders: ['cpu'] },
  });

  await ocr.initialize();

  post({ type: 'ready' });
  tick();
}

// ── Tick loop ─────────────────────────────────────────────────────────────────
// Runs until the main thread terminates the worker.

function tick(): void {
  const start = performance.now();
  runPipeline()
    .catch((err: Error) => {
      console.error('[OCR] Pipeline error:', err.message);
      post({ type: 'fail' });
    })
    .finally(() => {
      const elapsed = performance.now() - start;
      setTimeout(tick, Math.max(0, 1000 - elapsed));
    });
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

async function runPipeline(): Promise<void> {
  if (!config.processName?.trim()) {
    post({ type: 'noProcess' });
    return;
  }

  const captureResult = await captureWindowRegion(config.processName);
  if (!captureResult) {
    post({ type: 'fail' });
    return;
  }

  const { rawRGBA, width, height } = captureResult;

  const ocrStart = performance.now();

  const [blue, red] = await Promise.all([
    preprocessRegion(rawRGBA, width, height, config.regions.blueGold, 'blue'),
    preprocessRegion(rawRGBA, width, height, config.regions.redGold,  'red'),
  ]);

  const recognitor = (ocr as any).recognitor;

  const [blueCanvas, redCanvas] = await Promise.all([
    CanvasProcessor!.prepareCanvas(blue.buffer),
    CanvasProcessor!.prepareCanvas(red.buffer),
  ]);

  const [blueResults, redResults] = await Promise.all([
    recognitor.run(blueCanvas, [{ x: 0, y: 0, width: blue.width, height: blue.height }]),
    recognitor.run(redCanvas,  [{ x: 0, y: 0, width: red.width,  height: red.height  }]),
  ]);

  const ocrMs   = (performance.now() - ocrStart).toFixed(0);
  const blueRaw = (blueResults as { text: string }[]).map(r => r.text).join(' ').trim();
  const redRaw  = (redResults  as { text: string }[]).map(r => r.text).join(' ').trim();

  console.log(`[OCR] blue="${blueRaw}" red="${redRaw}" (${ocrMs}ms)`);

  const blueParsed = parseGoldValue(blueRaw);
  const redParsed  = parseGoldValue(redRaw);

  if (!blueParsed.valid || !redParsed.valid) {
    post({ type: 'fail' });
    return;
  }

  post({
    type:      'reading',
    blueGold:  blueParsed.value,
    redGold:   redParsed.value,
    timestamp: Date.now(),
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

init().catch((err: Error) => {
  console.error('[OCR Worker] Init error:', err);
  post({ type: 'initError', error: err?.message ?? String(err) });
  process.exit(1);
});
