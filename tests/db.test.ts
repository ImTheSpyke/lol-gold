import { openDatabase, closeDatabase, pingDB } from '../src/db/connection';
import { runMigrations } from '../src/db/migrations';
import { createGame, getGame, listGames, insertReading, getGraphData } from '../src/db/queries';

beforeEach(() => runMigrations(openDatabase(':memory:')));
afterEach(() => closeDatabase());

describe('sqlite queries', () => {
  it('pings when open', () => {
    expect(pingDB()).toBe(true);
  });

  it('creates and fetches a game', async () => {
    const uuid = await createGame('Final', 'Grand final');
    expect(await getGame(uuid)).toMatchObject({ uuid, name: 'Final', description: 'Grand final' });
    expect(await getGame('missing')).toBeNull();
  });

  it('paginates games newest first', async () => {
    for (let i = 0; i < 3; i++) await createGame(`g${i}`);
    const result = await listGames(1, 2);
    expect(result).toMatchObject({ total: 3, totalPages: 2, perPage: 2 });
    expect(result.games).toHaveLength(2);
  });

  it('stores readings ordered by time', async () => {
    const uuid = await createGame();
    insertReading(uuid, 12.5, 11.0, new Date(2000));
    insertReading(uuid, 10.0, 9.5, new Date(1000));
    const rows = await getGraphData(uuid);
    expect(rows.map(r => r.blue_gold)).toEqual([10.0, 12.5]);
    expect(rows[0].recorded_at).toEqual(new Date(1000));
  });
});
