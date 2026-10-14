import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createGame, listGames, getGame } from '../../db/queries';
import { gameNotFound, sendError } from '../errors';

const CreateGameSchema = z.object({
  name:        z.string().max(255).optional(),
  description: z.string().optional(),
});

const ListQuerySchema = z.object({
  page:    z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export async function gamesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (req, reply) => {
    const query = ListQuerySchema.safeParse(req.query);
    if (!query.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Invalid query parameters');
    }
    const { page, perPage } = query.data;
    const result = await listGames(page, perPage);
    return reply.send(result);
  });

  app.post('/', async (req, reply) => {
    const body = CreateGameSchema.safeParse(req.body);
    if (!body.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Invalid request body');
    }
    try {
      const uuid = await createGame(body.data.name, body.data.description);
      const game = await getGame(uuid);
      return reply.status(201).send({ uuid, created_at: game?.created_at });
    } catch (err) {
      app.log.error(err);
      return sendError(reply, 500, 'DB_ERROR', 'Database error');
    }
  });

  app.get('/:uuid', async (req, reply) => {
    const { uuid } = req.params as { uuid: string };
    const game = await getGame(uuid);
    if (!game) {
      return gameNotFound(reply);
    }
    return reply.send(game);
  });
}
