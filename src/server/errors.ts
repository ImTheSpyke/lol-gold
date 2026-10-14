import type { FastifyReply } from 'fastify';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'GAME_NOT_FOUND'
  | 'SESSION_ALREADY_RUNNING'
  | 'DB_ERROR'
  | 'EXPORT_ERROR'
  | 'INTERNAL_ERROR';

/** Sends the API's structured error body: `{ error, code, statusCode }`. */
export function sendError(reply: FastifyReply, statusCode: number, code: ErrorCode, error: string): FastifyReply {
  return reply.status(statusCode).send({ error, code, statusCode });
}

export const gameNotFound = (reply: FastifyReply): FastifyReply =>
  sendError(reply, 404, 'GAME_NOT_FOUND', 'Game not found');
