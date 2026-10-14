import Fastify, { type FastifyError } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { SessionManager } from '../session/manager';
import { sendError } from './errors';
import { CHARTJS_DIST_DIR, PUBLIC_DIR } from './paths';
import { pageRoutes }    from './routes/pages';
import { gamesRoutes }   from './routes/games';
import { sessionRoutes } from './routes/session';
import { configRoutes }  from './routes/config';
import { graphRoutes }   from './routes/graph';
import { healthRoutes }  from './routes/health';

export function buildServer(sessionManager: SessionManager) {
  const app = Fastify({ logger: { level: 'info' } });

  app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: '/static/' });
  app.register(fastifyStatic, { root: CHARTJS_DIST_DIR, prefix: '/vendor/chart.js/', decorateReply: false });

  app.register(healthRoutes);
  app.register(pageRoutes);
  app.register(gamesRoutes,                   { prefix: '/api/games' });
  app.register(sessionRoutes(sessionManager), { prefix: '/api/session' });
  app.register(configRoutes(sessionManager),  { prefix: '/api/config' });
  app.register(graphRoutes(sessionManager),   { prefix: '/api/graph' });

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    app.log.error(err);
    void sendError(reply, err.statusCode ?? 500, 'INTERNAL_ERROR', err.message);
  });

  return app;
}
