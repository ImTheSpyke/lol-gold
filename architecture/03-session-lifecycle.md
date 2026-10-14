# Architecture: Session Lifecycle

## Overview

The session manager (`src/session/manager.ts`) is the central state machine that coordinates: the OCR worker thread, database inserts, auto-start/stop logic, and dashboard state. It runs in the main process and communicates with the OCR worker via `worker_threads` message passing.

---

## State Machine

```
States: IDLE | RUNNING

Transitions:
  IDLE → RUNNING:
    - Manual: user clicks "Start OCR" (requires activeGameUUID set)
    - Auto:   autoStart=true AND OCR worker emits valid reading while in IDLE

  RUNNING → IDLE:
    - Manual: user clicks "Stop OCR"
    - Auto:   autoStop=true AND consecutiveFails >= 5
              → deselects activeGameUUID
              → emits 'session:stopped' event to dashboard SSE

  IDLE (monitoring mode):
    - OCR worker continues ticking even in IDLE when autoStart=true
    - Readings received in IDLE are discarded (not inserted to DB)
    - A valid reading in IDLE + autoStart=true → transition to RUNNING
```

---

## Session Manager Implementation

```typescript
// src/session/manager.ts

import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import { insertReading } from '../db/queries';
import { AppConfig, saveConfig } from '../config/config';

export type SessionState = 'IDLE' | 'RUNNING';

export class SessionManager extends EventEmitter {
  private state: SessionState = 'IDLE';
  private worker: Worker;
  private config: AppConfig;
  private consecutiveFails = 0;
  private activeGameUUID: string | null = null;

  constructor(worker: Worker, config: AppConfig) {
    super();
    this.worker = worker;
    this.config = config;
    this.attachWorkerListeners();
  }

  private attachWorkerListeners() {
    this.worker.on('message', (msg: WorkerMessage) => {
      switch (msg.type) {
        case 'reading':
          this.handleReading(msg);
          break;
        case 'fail':
          this.handleFail();
          break;
      }
    });

    this.worker.on('error', (err) => {
      console.error('[Worker] Crashed:', err);
      this.emit('worker:crash', err);
      // Respawn logic handled in index.ts
    });
  }

  private handleReading(msg: ReadingMessage) {
    this.consecutiveFails = 0;

    if (this.state === 'IDLE') {
      if (this.config.autoStart && this.activeGameUUID) {
        this.transitionTo('RUNNING');
      }
      return; // discard reading — not yet RUNNING
    }

    // RUNNING state: insert to DB
    if (this.activeGameUUID) {
      insertReading(
        this.activeGameUUID,
        msg.blueGold,
        msg.redGold,
        new Date(msg.timestamp)
      ); // fire-and-forget
    }

    this.emit('session:reading', {
      blueGold: msg.blueGold,
      redGold: msg.redGold,
      timestamp: msg.timestamp,
    });
  }

  private handleFail() {
    this.consecutiveFails++;

    if (
      this.state === 'RUNNING' &&
      this.config.autoStop &&
      this.consecutiveFails >= 5
    ) {
      this.autoStop();
    }
  }

  private autoStop() {
    const stoppedUUID = this.activeGameUUID;
    this.activeGameUUID = null;
    this.config.activeGameUUID = null;
    saveConfig(this.config); // persist deselection
    this.transitionTo('IDLE');
    this.emit('session:autoStopped', { gameUUID: stoppedUUID });
  }

  start(gameUUID: string): void {
    if (this.state === 'RUNNING') throw new Error('Already running');
    this.activeGameUUID = gameUUID;
    this.consecutiveFails = 0;
    this.config.activeGameUUID = gameUUID;
    saveConfig(this.config);
    this.transitionTo('RUNNING');
    // Tell worker to begin emitting results (or worker always runs and we just change state)
    this.worker.postMessage({ type: 'setActive', active: true });
  }

  stop(): void {
    this.activeGameUUID = null;
    this.config.activeGameUUID = null;
    saveConfig(this.config);
    this.transitionTo('IDLE');
    this.worker.postMessage({ type: 'setActive', active: false });
  }

  setConfig(config: AppConfig): void {
    this.config = config;
    this.worker.postMessage({ type: 'updateConfig', config });
  }

  getState(): SessionState { return this.state; }
  getActiveUUID(): string | null { return this.activeGameUUID; }
  getConsecutiveFails(): number { return this.consecutiveFails; }

  private transitionTo(next: SessionState) {
    const prev = this.state;
    this.state = next;
    this.emit('session:stateChange', { from: prev, to: next });
    console.info(`[Session] ${prev} → ${next}`);
  }
}

// Message type definitions
interface ReadingMessage {
  type: 'reading';
  blueGold: number;
  redGold: number;
  timestamp: number;
}

interface FailMessage {
  type: 'fail';
  consecutiveFails: number;
}

type WorkerMessage = ReadingMessage | FailMessage;
```

---

## OCR Worker — Active Mode

The OCR worker always runs its 1Hz tick loop regardless of session state. The `setActive` message controls whether the worker sends full reading results or just fail signals:

```typescript
// In worker.ts
let isActive = false;

parentPort.on('message', (msg) => {
  if (msg.type === 'setActive') isActive = msg.active;
  if (msg.type === 'updateConfig') updateConfig(msg.config);
});

// In tick():
if (bothValid) {
  parentPort.postMessage({ type: 'reading', blueGold, redGold, timestamp });
} else {
  parentPort.postMessage({ type: 'fail' });
}
```

**Why always tick**: This enables auto-start detection. The session manager receives the `reading` message even in IDLE and can trigger the RUNNING transition.

**When autoStart=false**: IDLE state still receives readings but ignores them (no transition possible). This is a no-op — the worker continues ticking but no DB inserts occur.

---

## Auto-Start / Auto-Stop Semantics Detail

### Auto-Stop
```
RUNNING + autoStop=true
  → each fail: consecutiveFails++
  → consecutiveFails >= 5:
      → activeGameUUID = null (deselected, saved to config.json)
      → state = IDLE
      → emit 'session:autoStopped'
      → dashboard SSE pushes notification to UI
```

Dashboard UI behavior on auto-stop:
- Game UUID selector shows "(none selected)"
- Start button becomes disabled
- Status indicator shows "Stopped"

### Auto-Start
```
IDLE + autoStart=true + activeGameUUID != null
  → valid reading received:
      → consecutiveFails = 0
      → state = RUNNING
      → emit 'session:stateChange'
      → dashboard SSE pushes notification to UI
```

**Note**: Auto-start requires `activeGameUUID` to be set. After an auto-stop event deselects the UUID, auto-start cannot trigger again until the user manually selects a game. This prevents accidental re-attachment to the wrong game after an auto-stop.

### Auto-Start after Auto-Stop

This is intentionally prevented. After auto-stop:
1. `activeGameUUID = null`
2. Worker keeps ticking (in case user reselects)
3. Valid readings arrive → `activeGameUUID === null` → no auto-start
4. User must manually select a game UUID and optionally click Start or wait for auto-start with the new UUID selected

---

## Worker Respawn

If the OCR worker crashes (`worker.on('error')`):

```typescript
// index.ts
function spawnOCRWorker(): Worker {
  const worker = new Worker(path.join(__dirname, 'ocr/worker.js'));
  worker.on('error', (err) => {
    console.error('[Main] Worker crashed, respawning in 2s:', err);
    setTimeout(() => {
      const newWorker = spawnOCRWorker();
      sessionManager.replaceWorker(newWorker);
    }, 2000);
  });
  return worker;
}
```

Worker crash counts as consecutive fails. With autoStop=true and a crashing worker, the session will auto-stop within 5 seconds of the crash.

---

## State Exposed to Dashboard

The session status API (`GET /api/session/status`) returns:

```json
{
  "state": "RUNNING",
  "activeGameUUID": "550e8400-e29b-41d4-a716-446655440000",
  "consecutiveFails": 0,
  "autoStart": true,
  "autoStop": true,
  "processName": "League Of Legends"
}
```

The dashboard polls this endpoint every 2s to keep the UI status indicator in sync.
