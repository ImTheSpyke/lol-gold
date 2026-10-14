import type { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import { insertReading } from '../db/queries';
import { saveConfig, type AppConfig } from '../config/config';
import type { ReadingMessage, WorkerOutMessage } from '../ocr/messages';

export type SessionState  = 'IDLE' | 'RUNNING';
export type WorkerFactory = (config: AppConfig) => Worker;

// Gold can't plausibly move this much (in k) between two 1Hz readings.
const MAX_GOLD_DELTA       = 10;
const AUTO_STOP_FAILS      = 5;
const WORKER_RESPAWN_DELAY = 2000;

export class SessionManager extends EventEmitter {
  private state: SessionState = 'IDLE';
  private worker: Worker;
  private config: AppConfig;
  private consecutiveFails = 0;
  private activeGameUUID: string | null = null;
  private lastBlue: number | null = null;
  private lastRed:  number | null = null;
  private closing = false;

  constructor(config: AppConfig, private readonly spawnWorker: WorkerFactory) {
    super();
    this.config         = config;
    this.activeGameUUID = config.activeGameUUID;
    this.worker         = this.attachWorker(spawnWorker(config));
  }

  private attachWorker(worker: Worker): Worker {
    worker.on('message', (msg: WorkerOutMessage) => {
      switch (msg.type) {
        case 'ready':
          console.log('[Session] OCR worker ready');
          break;
        case 'reading':
          this.handleReading(msg);
          break;
        case 'fail':
          this.handleFail();
          break;
        case 'noProcess':
          this.emit('worker:noProcess');
          break;
        case 'initError':
          console.error('[Session] OCR worker init error:', msg.error);
          this.emit('worker:crash', new Error(msg.error));
          break;
      }
    });

    worker.on('error', (err: Error) => {
      console.error('[Session] Worker error:', err.message);
      this.emit('worker:crash', err);
    });

    worker.on('exit', (code: number) => {
      if (this.closing || code === 0) return;
      console.error(`[Session] Worker exited with code ${code}, respawning in ${WORKER_RESPAWN_DELAY}ms`);
      setTimeout(() => {
        if (this.closing) return;
        this.consecutiveFails = 0;
        this.worker = this.attachWorker(this.spawnWorker(this.config));
        this.emit('worker:respawned');
      }, WORKER_RESPAWN_DELAY);
    });

    return worker;
  }

  private handleReading(msg: ReadingMessage): void {
    const { blueGold, redGold } = msg;

    // Reject implausible jumps vs the last accepted reading (OCR misreads)
    if (this.lastBlue !== null && Math.abs(blueGold - this.lastBlue) >= MAX_GOLD_DELTA) {
      console.warn(`[Session] Reading rejected — blue delta too large: ${this.lastBlue} → ${blueGold}`);
      this.handleFail();
      return;
    }
    if (this.lastRed !== null && Math.abs(redGold - this.lastRed) >= MAX_GOLD_DELTA) {
      console.warn(`[Session] Reading rejected — red delta too large: ${this.lastRed} → ${redGold}`);
      this.handleFail();
      return;
    }

    this.consecutiveFails = 0;
    this.lastBlue = blueGold;
    this.lastRed  = redGold;

    if (this.state === 'IDLE') {
      if (this.config.autoStart && this.activeGameUUID) {
        this.transitionTo('RUNNING');
        this.emit('session:autoStarted', { gameUUID: this.activeGameUUID });
      }
      return;
    }

    if (this.activeGameUUID) {
      insertReading(this.activeGameUUID, blueGold, redGold, new Date(msg.timestamp));
    }

    this.emit('session:reading', { blueGold, redGold, timestamp: msg.timestamp });
  }

  private handleFail(): void {
    this.consecutiveFails++;

    if (
      this.state === 'RUNNING' &&
      this.config.autoStop &&
      this.consecutiveFails >= AUTO_STOP_FAILS
    ) {
      this.performAutoStop();
    }
  }

  private performAutoStop(): void {
    const stoppedUUID = this.activeGameUUID;
    this.resetSession(null);
    this.transitionTo('IDLE');
    this.emit('session:autoStopped', { gameUUID: stoppedUUID });
  }

  private resetSession(gameUUID: string | null): void {
    this.activeGameUUID        = gameUUID;
    this.config.activeGameUUID = gameUUID;
    this.lastBlue              = null;
    this.lastRed               = null;
    saveConfig(this.config);
  }

  start(gameUUID: string): void {
    if (this.state === 'RUNNING') {
      throw new Error('SESSION_ALREADY_RUNNING');
    }
    this.consecutiveFails = 0;
    this.resetSession(gameUUID);
    this.transitionTo('RUNNING');
  }

  stop(): void {
    this.resetSession(null);
    this.transitionTo('IDLE');
  }

  selectGame(gameUUID: string | null): void {
    this.activeGameUUID        = gameUUID;
    this.config.activeGameUUID = gameUUID;
    saveConfig(this.config);
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
    this.worker.postMessage({ type: 'updateConfig', config });
  }

  /** Stops the OCR worker for good (no respawn). */
  async close(): Promise<void> {
    this.closing = true;
    await this.worker.terminate();
  }

  getState(): SessionState         { return this.state; }
  getActiveUUID(): string | null   { return this.activeGameUUID; }
  getConsecutiveFails(): number    { return this.consecutiveFails; }
  getConfig(): AppConfig           { return this.config; }

  private transitionTo(next: SessionState): void {
    const prev = this.state;
    this.state = next;
    this.emit('session:stateChange', { from: prev, to: next });
    console.info(`[Session] ${prev} → ${next}`);
  }
}
