import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadConfig, loadDBConfig, patchConfig } from '../../config/config';
import type { SessionManager } from '../../session/manager';

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
      const config   = loadConfig();
      const dbConfig = loadDBConfig();
      return reply.send({
        ...config,
        // DB credentials from env — mask password, expose connection info for dashboard display
        db: {
          host:     dbConfig.host,
          port:     dbConfig.port,
          user:     dbConfig.user,
          password: dbConfig.password ? '***' : '',
          database: dbConfig.database,
        },
      });
    });

    app.post('/', async (req, reply) => {
      const body = ConfigPatchSchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({
          error:      'Invalid config patch',
          code:       'VALIDATION_ERROR',
          statusCode: 400,
        });
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
