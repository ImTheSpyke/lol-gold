import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import { insertReading } from '../db/queries';
import { saveConfig, type AppConfig } from '../config/config';

export type SessionState = 'IDLE' | 'RUNNING';

interface ReadingMessage {
  type:      'reading';
  blueGold:  number;
  redGold:   number;
  timestamp: number;
}

interface FailMessage      { type: 'fail'; }
interface NoProcessMessage { type: 'noProcess'; }
interface ReadyMessage     { type: 'ready'; }
interface InitErrorMessage { type: 'initError'; error: string; }

type WorkerMessage = ReadingMessage | FailMessage | NoProcessMessage | ReadyMessage | InitErrorMessage;

const MAX_GOLD_VALUE  = 200;
const MAX_GOLD_DELTA  = 10;

export class SessionManager extends EventEmitter {
  private state: SessionState = 'IDLE';
  private worker: Worker;
  private config: AppConfig;
  private consecutiveFails = 0;
  private activeGameUUID: string | null = null;
  private lastBlue: number | null = null;
  private lastRed:  number | null = null;

  constructor(worker: Worker, config: AppConfig) {
    super();
    this.worker = worker;
    this.config = config;
    this.activeGameUUID = config.activeGameUUID;
    this.attachWorkerListeners();
  }

  private attachWorkerListeners(): void {
    this.worker.on('message', (msg: WorkerMessage) => {
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

    this.worker.on('error', (err: Error) => {
      console.error('[Session] Worker error:', err.message);
      this.emit('worker:crash', err);
    });

    this.worker.on('exit', (code: number) => {
      if (code !== 0 && running) {
        console.error(`[Session] Worker exited with code ${code}`);
        this.emit('worker:crash', new Error(`Worker exited with code ${code}`));
      }
    });
  }

  private handleReading(msg: ReadingMessage): void {
    const { blueGold, redGold } = msg;

    // Absolute cap
    if (blueGold > MAX_GOLD_VALUE || redGold > MAX_GOLD_VALUE) {
      console.warn(`[Session] Reading rejected — value out of range: blue=${blueGold} red=${redGold}`);
      this.handleFail();
      return;
    }

    // Max delta per tick vs last accepted reading
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
      insertReading(
        this.activeGameUUID,
        blueGold,
        redGold,
        new Date(msg.timestamp)
      );
    }

    this.emit('session:reading', {
      blueGold:  msg.blueGold,
      redGold:   msg.redGold,
      timestamp: msg.timestamp,
    });
  }

  private handleFail(): void {
    this.consecutiveFails++;

    if (
      this.state === 'RUNNING' &&
      this.config.autoStop &&
      this.consecutiveFails >= 5
    ) {
      this.performAutoStop();
    }
  }

  private performAutoStop(): void {
    const stoppedUUID     = this.activeGameUUID;
    this.activeGameUUID   = null;
    this.config.activeGameUUID = null;
    this.lastBlue = null;
    this.lastRed  = null;
    saveConfig(this.config);
    this.transitionTo('IDLE');
    this.emit('session:autoStopped', { gameUUID: stoppedUUID });
  }

  start(gameUUID: string): void {
    if (this.state === 'RUNNING') {
      throw new Error('SESSION_ALREADY_RUNNING');
    }
    this.activeGameUUID        = gameUUID;
    this.consecutiveFails      = 0;
    this.lastBlue              = null;
    this.lastRed               = null;
    this.config.activeGameUUID = gameUUID;
    saveConfig(this.config);
    this.transitionTo('RUNNING');
    this.worker.postMessage({ type: 'setActive', active: true });
  }

  stop(): void {
    this.activeGameUUID        = null;
    this.config.activeGameUUID = null;
    this.lastBlue              = null;
    this.lastRed               = null;
    saveConfig(this.config);
    this.transitionTo('IDLE');
    this.worker.postMessage({ type: 'setActive', active: false });
  }

  selectGame(gameUUID: string | null): void {
    this.activeGameUUID        = gameUUID;
    this.config.activeGameUUID = gameUUID;
    saveConfig(this.config);
  }

  replaceWorker(newWorker: Worker): void {
    this.worker = newWorker;
    this.consecutiveFails = 0;
    this.attachWorkerListeners();
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
    this.worker.postMessage({ type: 'updateConfig', config });
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

// Needed for exit handler in worker listener
const running = true;
