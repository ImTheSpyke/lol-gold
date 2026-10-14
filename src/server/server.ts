import Fastify, { type FastifyError } from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import type { SessionManager } from '../session/manager';
import { dashboardRoutes } from './routes/dashboard';
import { gamesRoutes }     from './routes/games';
import { sessionRoutes }   from './routes/session';
import { configRoutes }    from './routes/config';
import { graphDataRoutes } from './routes/graphData';

export function buildServer(sessionManager: SessionManager) {
  const app = Fastify({ logger: { level: 'info' } });

  app.register(fastifyStatic, {
    root:   path.join(__dirname, 'static'),
    prefix: '/static/',
  });

  app.register(dashboardRoutes);
  app.register(gamesRoutes,                   { prefix: '/api/games' });
  app.register(sessionRoutes(sessionManager), { prefix: '/api/session' });
  app.register(configRoutes(sessionManager),  { prefix: '/api/config' });
  app.register(graphDataRoutes(sessionManager), { prefix: '/api/graph' });

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    app.log.error(err);
    void reply.status(err.statusCode ?? 500).send({
      error:      err.message,
      code:       'INTERNAL_ERROR',
      statusCode: err.statusCode ?? 500,
    });
  });

  return app;
}
