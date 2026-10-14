import path from 'path';
import { Worker } from 'worker_threads';
import type { AppConfig } from '../config/config';

/** Starts the OCR worker thread (TypeScript source in dev, compiled JS in prod). */
export function spawnOCRWorker(config: AppConfig): Worker {
  const isDev = __filename.endsWith('.ts');
  return isDev
    ? new Worker(path.join(__dirname, 'worker.ts'), { workerData: { config }, execArgv: ['-r', 'ts-node/register'] })
    : new Worker(path.join(__dirname, 'worker.js'), { workerData: { config } });
}
