import type { GraphRow } from '../db/queries';

export interface GraphPoint {
  /** Seconds elapsed since the first reading of the game. */
  t:        number;
  blueGold: number;
  redGold:  number;
  /** blueGold - redGold, in thousands of gold. */
  diff:     number;
}

export function toGraphPoints(rows: GraphRow[]): GraphPoint[] {
  if (!rows.length) return [];
  const startMs = new Date(rows[0].recorded_at).getTime();

  return rows.map(row => {
    const blue = row.blue_gold;
    const red  = row.red_gold;
    return {
      t:        (new Date(row.recorded_at).getTime() - startMs) / 1000,
      blueGold: blue,
      redGold:  red,
      diff:     blue - red,
    };
  });
}
