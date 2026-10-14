import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createGame, listGames, getGame } from '../../db/queries';

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
      return reply.status(400).send({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR', statusCode: 400 });
    }
    const { page, perPage } = query.data;
    const result = await listGames(page, perPage);
    return reply.send(result);
  });

  app.post('/', async (req, reply) => {
    const body = CreateGameSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body', code: 'VALIDATION_ERROR', statusCode: 400 });
    }
    try {
      const uuid = await createGame(body.data.name, body.data.description);
      const game = await getGame(uuid);
      return reply.status(201).send({ uuid, created_at: game?.created_at });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Database error', code: 'DB_ERROR', statusCode: 500 });
    }
  });

  app.get('/:uuid', async (req, reply) => {
    const { uuid } = req.params as { uuid: string };
    const game = await getGame(uuid);
    if (!game) {
      return reply.status(404).send({ error: 'Game not found', code: 'GAME_NOT_FOUND', statusCode: 404 });
    }
    return reply.send(game);
  });
}
