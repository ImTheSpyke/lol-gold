import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SessionManager } from '../../session/manager';
import { getGame } from '../../db/queries';

const StartSchema = z.object({
  gameUUID: z.string().uuid(),
});

const SelectSchema = z.object({
  gameUUID: z.string().uuid().nullable(),
});

export function sessionRoutes(sessionManager: SessionManager) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get('/status', async (_req, reply) => {
      const config = sessionManager.getConfig();
      return reply.send({
        state:           sessionManager.getState(),
        activeGameUUID:  sessionManager.getActiveUUID(),
        consecutiveFails: sessionManager.getConsecutiveFails(),
        autoStart:       config.autoStart,
        autoStop:        config.autoStop,
        processName:     config.processName,
      });
    });

    app.post('/start', async (req, reply) => {
      const body = StartSchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid request body', code: 'VALIDATION_ERROR', statusCode: 400 });
      }

      const game = await getGame(body.data.gameUUID);
      if (!game) {
        return reply.status(404).send({ error: 'Game not found', code: 'GAME_NOT_FOUND', statusCode: 404 });
      }

      try {
        sessionManager.start(body.data.gameUUID);
        return reply.send({ ok: true });
      } catch (err) {
        const message = (err as Error).message;
        if (message === 'SESSION_ALREADY_RUNNING') {
          return reply.status(409).send({ error: 'Session already running', code: 'SESSION_ALREADY_RUNNING', statusCode: 409 });
        }
        return reply.status(500).send({ error: message, code: 'INTERNAL_ERROR', statusCode: 500 });
      }
    });

    app.post('/stop', async (_req, reply) => {
      sessionManager.stop();
      return reply.send({ ok: true });
    });

    app.post('/select', async (req, reply) => {
      const body = SelectSchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid request body', code: 'VALIDATION_ERROR', statusCode: 400 });
      }

      if (body.data.gameUUID !== null) {
        const game = await getGame(body.data.gameUUID);
        if (!game) {
          return reply.status(404).send({ error: 'Game not found', code: 'GAME_NOT_FOUND', statusCode: 404 });
        }
      }

      sessionManager.selectGame(body.data.gameUUID);
      return reply.send({ ok: true });
    });

    // SSE endpoint for real-time dashboard push
    app.get('/events', (req, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      reply.raw.flushHeaders();

      const send = (data: object): void => {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const onStateChange = (e: object): void => send({ type: 'stateChange', ...e });
      const onAutoStopped = (e: object): void => send({ type: 'autoStopped', ...e });
      const onAutoStarted = (e: object): void => send({ type: 'autoStarted', ...e });
      const onWorkerCrash = (e: Error):  void => send({ type: 'workerCrash', error: e.message });
      const onNoProcess   = ():          void => send({ type: 'noProcess' });

      sessionManager.on('session:stateChange', onStateChange);
      sessionManager.on('session:autoStopped', onAutoStopped);
      sessionManager.on('session:autoStarted', onAutoStarted);
      sessionManager.on('worker:crash',        onWorkerCrash);
      sessionManager.on('worker:noProcess',    onNoProcess);

      const keepAlive = setInterval(() => {
        reply.raw.write(': ping\n\n');
      }, 15000);

      req.raw.on('close', () => {
        clearInterval(keepAlive);
        sessionManager.off('session:stateChange', onStateChange);
        sessionManager.off('session:autoStopped', onAutoStopped);
        sessionManager.off('session:autoStarted', onAutoStarted);
        sessionManager.off('worker:crash',        onWorkerCrash);
        sessionManager.off('worker:noProcess',    onNoProcess);
      });

      return reply;
    });
  };
}
