import type { FastifyInstance } from 'fastify';
import { getGame, getGraphData } from '../../db/queries';
import { exportToPNG } from '../../graph/export';
import { toGraphPoints } from '../../graph/readings';
import type { SessionManager } from '../../session/manager';
import { gameNotFound, sendError } from '../errors';

export function graphRoutes(sessionManager: SessionManager) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get('/:gameUUID/data', async (req, reply) => {
      const { gameUUID } = req.params as { gameUUID: string };

      const game = await getGame(gameUUID);
      if (!game) return gameNotFound(reply);

      const rows = await getGraphData(gameUUID);

      return reply.send({
        gameUUID,
        gameName:  game.name,
        active:    sessionManager.getActiveUUID() === gameUUID,
        startTime: rows.length ? new Date(rows[0].recorded_at).toISOString() : null,
        readings:  toGraphPoints(rows),
      });
    });

    app.get('/:gameUUID/export', async (req, reply) => {
      const { gameUUID } = req.params as { gameUUID: string };
      const smooth       = (req.query as Record<string, string>)['smooth'] === '1';

      const game = await getGame(gameUUID);
      if (!game) return gameNotFound(reply);

      const readings = toGraphPoints(await getGraphData(gameUUID));
      if (!readings.length) {
        return reply.status(204).send();
      }

      try {
        const png = await exportToPNG(readings, smooth);
        return reply
          .header('Content-Type', 'image/png')
          .header('Content-Disposition', `attachment; filename="gold-${gameUUID}.png"`)
          .send(png);
      } catch (err) {
        app.log.error(err);
        return sendError(reply, 500, 'EXPORT_ERROR', 'Export failed');
      }
    });
  };
}
