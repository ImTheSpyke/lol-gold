import type { AppConfig } from '../config/config';

/** Messages sent from the main thread to the OCR worker. */
export type WorkerInMessage = { type: 'updateConfig'; config: AppConfig };

export interface ReadingMessage {
  type:      'reading';
  blueGold:  number;
  redGold:   number;
  timestamp: number;
}

/** Messages sent from the OCR worker to the main thread. */
export type WorkerOutMessage =
  | { type: 'ready' }
  | ReadingMessage
  | { type: 'fail' }
  | { type: 'noProcess' }
  | { type: 'initError'; error: string };
