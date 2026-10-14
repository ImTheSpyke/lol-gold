import 'dotenv/config';
import path from 'path';
import { Worker } from 'worker_threads';
import { loadConfig, loadDBConfig } from './config/config';
import { createPool, pingDB } from './db/connection';
import { runMigrations } from './db/migrations';
import { SessionManager } from './session/manager';
import { buildServer } from './server/server';

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

async function main(): Promise<void> {
  const config   = loadConfig();
  const dbConfig = loadDBConfig();

  console.log('[Main] Config loaded');
  console.log(`[Main] Connecting to DB at ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);

  const pool = createPool(dbConfig);

  try {
    await runMigrations(pool);
  } catch (err) {
    console.error('[Main] Migration failed:', (err as Error).message);
    process.exit(1);
  }

  // DB health check every 30s
  setInterval(async () => {
    const ok = await pingDB();
    if (!ok) console.warn('[Main] DB health check failed — connection may be lost');
  }, 30000);

  const worker         = spawnOCRWorker(config, null);
  const sessionManager = new SessionManager(worker, config);

  const app = buildServer(sessionManager);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[Main] Received ${signal}, shutting down...`);
    sessionManager.stop();
    worker.postMessage({ type: 'shutdown' });
    await app.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT',  () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`[Main] Dashboard running at http://localhost:${PORT}`);
  } catch (err) {
    console.error('[Main] Server failed to start:', err);
    process.exit(1);
  }
}

function spawnOCRWorker(
  config: ReturnType<typeof loadConfig>,
  sessionManager: SessionManager | null
): Worker {
  const isDev      = __filename.endsWith('.ts');
  const workerPath = isDev
    ? path.join(__dirname, 'ocr', 'worker.ts')
    : path.join(__dirname, 'ocr', 'worker.js');
  const workerOpts = isDev
    ? { workerData: { config }, execArgv: ['-r', 'ts-node/register'] }
    : { workerData: { config } };
  const worker = new Worker(workerPath, workerOpts);

  worker.on('error', (err: Error) => {
    console.error('[Main] OCR Worker error:', err);
    if (sessionManager) {
      setTimeout(() => {
        const newWorker = spawnOCRWorker(sessionManager.getConfig(), sessionManager);
        sessionManager.replaceWorker(newWorker);
        sessionManager.emit('worker:respawned');
      }, 2000);
    }
  });

  worker.on('exit', (code: number) => {
    if (code !== 0) {
      console.error(`[Main] OCR Worker exited with code ${code}`);
    }
  });

  return worker;
}

main().catch((err: Error) => {
  console.error('[Main] Fatal error:', err.message);
  process.exit(1);
});
