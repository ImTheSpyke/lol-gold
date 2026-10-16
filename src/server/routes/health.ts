import type { FastifyInstance } from 'fastify';
import { pingDB } from '../../db/connection';

/** Liveness/readiness probe used by the monitoring. */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', { logLevel: 'warn' }, async (_req, reply) => {
    const db = await pingDB();
    return reply.status(db ? 200 : 503).send({ status: db ? 'ok' : 'degraded', db });
  });
}
