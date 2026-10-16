import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadConfig, loadDBPath, patchConfig } from '../../config/config';
import type { SessionManager } from '../../session/manager';
import { sendError } from '../errors';

interface ProcessEntry { appName: string; title: string; width: number; height: number; }

async function listProcesses(): Promise<ProcessEntry[]> {
  try {
    const { Window } = await import('node-screenshots');
    return Window.all()
      .map(w => ({
        appName: w.appName(),
        title:   w.title(),
        width:   w.width(),
        height:  w.height(),
      }))
      .filter(e => e.appName.trim())
      .sort((a, b) => a.appName.toLowerCase().localeCompare(b.appName.toLowerCase()));
  } catch (err) {
    console.error('[Processes] Failed to list windows:', (err as Error).message);
    return [];
  }
}

const RegionPatchSchema = z.object({
  x:      z.number().int().min(0).optional(),
  y:      z.number().int().min(0).optional(),
  width:  z.number().int().min(1).optional(),
  height: z.number().int().min(1).optional(),
});

const ConfigPatchSchema = z.object({
  processName: z.string().optional(),
  autoStart:   z.boolean().optional(),
  autoStop:    z.boolean().optional(),
  regions: z.object({
    blueGold: RegionPatchSchema.optional(),
    redGold:  RegionPatchSchema.optional(),
  }).optional(),
});

export function configRoutes(sessionManager: SessionManager) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get('/', async (_req, reply) => {
      return reply.send({ ...loadConfig(), dbPath: loadDBPath() });
    });

    app.post('/', async (req, reply) => {
      const body = ConfigPatchSchema.safeParse(req.body);
      if (!body.success) {
        return sendError(reply, 400, 'VALIDATION_ERROR', 'Invalid config patch');
      }

      const newConfig = patchConfig(body.data as Record<string, unknown>);
      sessionManager.updateConfig(newConfig);

      return reply.send({ ok: true });
    });

    app.get('/processes', async (_req, reply) => {
      return reply.send({ processes: await listProcesses() });
    });
  };
}
