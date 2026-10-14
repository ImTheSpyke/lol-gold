import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { captureWindowRegion } from './capture';
import { preprocessBlueRegion, preprocessRedRegion } from './preprocess';
import { parseGoldValue } from './parse';
import type { AppConfig } from '../config/config';

let config: AppConfig = workerData.config as AppConfig;
let running           = false;

type MainMessage =
  | { type: 'updateConfig'; config: AppConfig }
  | { type: 'setActive';    active: boolean }
  | { type: 'shutdown' };

export type WorkerOutMessage =
  | { type: 'ready' }
  | { type: 'reading'; blueGold: number; redGold: number; timestamp: number }
  | { type: 'fail' }
  | { type: 'noProcess' }
  | { type: 'initError'; error: string };

parentPort!.on('message', (msg: MainMessage) => {
  switch (msg.type) {
    case 'updateConfig': config = msg.config; break;
    case 'setActive':    break;
    case 'shutdown':     running = false; break;
  }
});

process.on('uncaughtException', (err) => {
  console.error('[OCR Worker] Uncaught exception:', err);
  try { parentPort!.postMessage({ type: 'initError', error: String(err) }); } catch {}
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[OCR Worker] Unhandled rejection:', reason);
  try { parentPort!.postMessage({ type: 'initError', error: String(reason) }); } catch {}
  process.exit(1);
});

// ── PaddleOCR ─────────────────────────────────────────────────────────────────

let ocr:            import('ppu-paddle-ocr').PaddleOcrService | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let CanvasProcessor: { prepareCanvas(buf: ArrayBuffer): Promise<any> } | null = null;

async function init(): Promise<void> {
  const { PaddleOcrService } = await (new Function('m', 'return import(m)'))('ppu-paddle-ocr') as typeof import('ppu-paddle-ocr');
  const ppuCanvas = await (new Function('m', 'return import(m)'))('ppu-ocv/canvas') as { CanvasProcessor: { prepareCanvas(buf: ArrayBuffer): Promise<any> } };
  CanvasProcessor = ppuCanvas.CanvasProcessor;

  ocr = new PaddleOcrService({
    processing: { engine: 'canvas-native' },
    detection:  { minimumAreaThreshold: 5, paddingVertical: 0.1, paddingHorizontal: 0.1 },
    session:    { executionProviders: ['cpu'] },
  });

  await ocr.initialize();

  running = true;
  parentPort!.postMessage({ type: 'ready' });
  tick();
}

// ── Tick loop ─────────────────────────────────────────────────────────────────

function tick(): void {
  if (!running) return;
  const start = performance.now();
  runPipeline()
    .catch((err: Error) => {
      console.error('[OCR] Pipeline error:', err.message);
      parentPort!.postMessage({ type: 'fail' });
    })
    .finally(() => {
      if (!running) return;
      const elapsed = performance.now() - start;
      setTimeout(tick, Math.max(0, 1000 - elapsed));
    });
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

async function runPipeline(): Promise<void> {
  if (!config.processName?.trim()) {
    parentPort!.postMessage({ type: 'noProcess' });
    return;
  }

  const captureResult = await captureWindowRegion(config.processName);
  if (!captureResult) {
    parentPort!.postMessage({ type: 'fail' });
    return;
  }

  const { rawRGBA, width, height } = captureResult;

  const ocrStart = performance.now();

  const [blue, red] = await Promise.all([
    preprocessBlueRegion(rawRGBA, width, height, config.regions.blueGold),
    preprocessRedRegion(rawRGBA, width, height, config.regions.redGold),
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
    parentPort!.postMessage({ type: 'fail' });
    return;
  }

  parentPort!.postMessage({
    type:      'reading',
    blueGold:  blueParsed.value,
    redGold:   redParsed.value,
    timestamp: Date.now(),
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

init().catch((err: Error) => {
  console.error('[OCR Worker] Init error:', err);
  parentPort!.postMessage({ type: 'initError', error: err?.message ?? String(err) });
  process.exit(1);
});
