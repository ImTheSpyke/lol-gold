import type { FastifyInstance } from 'fastify';
import fs from 'fs/promises';
import path from 'path';

const STATIC_DIR = path.join(__dirname, '..', 'static');

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (_req, reply) => {
    const html = await fs.readFile(path.join(STATIC_DIR, 'dashboard.html'), 'utf-8');
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  app.get('/recent', async (_req, reply) => {
    const html = await fs.readFile(path.join(STATIC_DIR, 'recentgames.html'), 'utf-8');
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  app.get('/graph/:gameUUID', async (req, reply) => {
    const { gameUUID } = req.params as { gameUUID: string };
    const smooth       = (req.query as Record<string, string>)['smooth'] === '1' ? '1' : '0';

    let html = await fs.readFile(path.join(STATIC_DIR, 'graph.html'), 'utf-8');
    html = html.replace(/\{\{GAME_UUID\}\}/g, gameUUID).replace(/\{\{SMOOTH\}\}/g, smooth);
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  app.get('/widget/current', async (req, reply) => {
    const smooth = (req.query as Record<string, string>)['smooth'] === '1' ? '1' : '0';
    let html = await fs.readFile(path.join(STATIC_DIR, 'widget-current.html'), 'utf-8');
    html = html.replace(/\{\{SMOOTH\}\}/g, smooth);
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  app.get('/widget/:gameUUID', async (req, reply) => {
    const { gameUUID } = req.params as { gameUUID: string };
    const smooth       = (req.query as Record<string, string>)['smooth'] === '1' ? '1' : '0';

    let html = await fs.readFile(path.join(STATIC_DIR, 'widget.html'), 'utf-8');
    html = html.replace(/\{\{GAME_UUID\}\}/g, gameUUID).replace(/\{\{SMOOTH\}\}/g, smooth);
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });
}
