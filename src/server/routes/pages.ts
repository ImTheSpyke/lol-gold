import type { FastifyInstance, FastifyReply } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { PUBLIC_DIR } from '../paths';

const UUIDParams  = z.object({ gameUUID: z.string().uuid() });
const SmoothQuery = z.object({ smooth: z.string().optional() });

/** Serves an HTML page from public/, substituting `{{KEY}}` placeholders. */
async function sendPage(reply: FastifyReply, file: string, vars: Record<string, string> = {}): Promise<FastifyReply> {
  let html = await fs.readFile(path.join(PUBLIC_DIR, file), 'utf-8');
  for (const [key, value] of Object.entries(vars)) {
    html = html.replaceAll(`{{${key}}}`, value);
  }
  return reply.type('text/html; charset=utf-8').send(html);
}

function smoothFlag(query: unknown): string {
  const parsed = SmoothQuery.safeParse(query);
  return parsed.success && parsed.data.smooth === '1' ? '1' : '0';
}

export async function pageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/',       (_req, reply) => sendPage(reply, 'dashboard.html'));
  app.get('/recent', (_req, reply) => sendPage(reply, 'recentgames.html'));

  app.get('/widget/current', (req, reply) =>
    sendPage(reply, 'widget-current.html', { SMOOTH: smoothFlag(req.query) }));

  // The game UUID is injected into the HTML, so it must be validated first.
  const gamePage = (file: string) => async (req: { params: unknown; query: unknown }, reply: FastifyReply) => {
    const params = UUIDParams.safeParse(req.params);
    if (!params.success) return reply.callNotFound();
    return sendPage(reply, file, { GAME_UUID: params.data.gameUUID, SMOOTH: smoothFlag(req.query) });
  };

  app.get('/graph/:gameUUID',  gamePage('graph.html'));
  app.get('/widget/:gameUUID', gamePage('widget.html'));
}
