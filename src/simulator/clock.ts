import 'server-only';
import { db } from '@/db/pool';

// 模拟时钟：每个访客独立的模拟日期。Demo 从 2026 年春招开始。
export const SEASON_START = '2026-03-03';
export const SEASON = 'spring';

export async function currentSimDate(visitorId: string): Promise<{ date: string; season: string }> {
  const [rows] = await db().query('SELECT current_sim AS date, season FROM sim_clocks WHERE visitor_id = ?', [visitorId]);
  const row = (rows as Array<{ date: string; season: string }>)[0];
  if (row) return row;
  await db().query('INSERT IGNORE INTO sim_clocks (visitor_id, current_sim, season) VALUES (?, ?, ?)', [visitorId, SEASON_START, SEASON]);
  return { date: SEASON_START, season: SEASON };
}
