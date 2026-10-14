import type { FastifyInstance } from 'fastify';
import { getGame, getGraphData } from '../../db/queries';
import { exportToPNG } from '../../export/png';
import type { SessionManager } from '../../session/manager';

export interface GraphPoint {
  t:        number;
  blueGold: number;
  redGold:  number;
  diff:     number;
}

export function graphDataRoutes(sessionManager: SessionManager) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get('/:gameUUID/data', async (req, reply) => {
      const { gameUUID } = req.params as { gameUUID: string };

      const game = await getGame(gameUUID);
      if (!game) {
        return reply.status(404).send({ error: 'Game not found', code: 'GAME_NOT_FOUND', statusCode: 404 });
      }

      const rows = await getGraphData(gameUUID);

      if (!rows.length) {
        return reply.send({
          gameUUID,
          gameName:  game.name,
          active:    sessionManager.getActiveUUID() === gameUUID,
          startTime: null,
          readings:  [],
        });
      }

      const startMs = new Date(rows[0].recorded_at).getTime();

      const readings: GraphPoint[] = rows.map(row => {
        const blue = parseFloat(row.blue_gold);
        const red  = parseFloat(row.red_gold);
        return {
          t:        (new Date(row.recorded_at).getTime() - startMs) / 1000,
          blueGold: blue,
          redGold:  red,
          diff:     blue - red,
        };
      });

      return reply.send({
        gameUUID,
        gameName:  game.name,
        active:    sessionManager.getActiveUUID() === gameUUID,
        startTime: new Date(rows[0].recorded_at).toISOString(),
        readings,
      });
    });

    app.get('/:gameUUID/export', async (req, reply) => {
      const { gameUUID } = req.params as { gameUUID: string };
      const smooth       = (req.query as Record<string, string>)['smooth'] === '1';

      const game = await getGame(gameUUID);
      if (!game) {
        return reply.status(404).send({ error: 'Game not found', code: 'GAME_NOT_FOUND', statusCode: 404 });
      }

      const rows = await getGraphData(gameUUID);
      if (!rows.length) {
        return reply.status(204).send();
      }

      const startMs = new Date(rows[0].recorded_at).getTime();
      const readings = rows.map(row => ({
        t:    (new Date(row.recorded_at).getTime() - startMs) / 1000,
        diff: parseFloat(row.blue_gold) - parseFloat(row.red_gold),
      }));

      try {
        const png = await exportToPNG(readings, smooth);
        return reply
          .header('Content-Type', 'image/png')
          .header('Content-Disposition', `attachment; filename="gold-${gameUUID}.png"`)
          .send(png);
      } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Export failed', code: 'EXPORT_ERROR', statusCode: 500 });
      }
    });
  };
}
