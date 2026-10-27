import 'server-only';
import { db } from '../pool';
import { DEFAULT_STRATEGY_PARAMS as DEFAULTS, type StrategyParams } from '@/domain/config';

// 策略表 strategies（按版本保存）
export type StrategyChange = { text: string; accepted: boolean; kind: string };
export type StrategyRow = {
  version: number; params: StrategyParams; source: 'default' | 'user' | 'review';
  source_review_id: string | null; source_round_no: number | null; source_sim: string | null; changes: StrategyChange[] | null; created_at: string;
};

export async function latestStrategy(visitorId: string): Promise<{ version: number; params: StrategyParams } | null> {
  const [rows] = await db().query('SELECT version, params FROM strategies WHERE visitor_id = ? ORDER BY version DESC LIMIT 1', [visitorId]);
  const row = (rows as Array<{ version: number; params: StrategyParams }>)[0];
  return row ? { version: row.version, params: { ...DEFAULTS, ...row.params } } : null; // 补上后来新增的参数
}
export async function getStrategy(visitorId: string, version: number): Promise<StrategyParams> {
  const [rows] = await db().query('SELECT params FROM strategies WHERE visitor_id = ? AND version = ?', [visitorId, version]);
  return { ...DEFAULTS, ...((rows as Array<{ params: StrategyParams }>)[0]?.params ?? {}) };
}

export async function ensureInitialStrategy(visitorId: string) {
  const [rows] = await db().query('SELECT COUNT(*) AS n FROM strategies WHERE visitor_id = ?', [visitorId]);
  if (Number((rows as Array<{ n: number }>)[0].n) > 0) return;
  await db().query(
    "INSERT INTO strategies (visitor_id, version, params, source) VALUES (?, 1, ?, 'default')",
    [visitorId, JSON.stringify(DEFAULTS)],
  );
}

/** 复盘后保存新版本策略，返回新版本号 */
export async function createStrategy(visitorId: string, params: StrategyParams, reviewId: string, changes: StrategyChange[]): Promise<number> {
  const [rows] = await db().query('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM strategies WHERE visitor_id = ?', [visitorId]);
  const version = Number((rows as Array<{ v: number }>)[0].v);
  await db().query(
    "INSERT INTO strategies (visitor_id, version, params, source, source_review_id, changes) VALUES (?, ?, ?, 'review', ?, ?)",
    [visitorId, version, JSON.stringify(params), reviewId, JSON.stringify(changes)],
  );
  return version;
}

export async function listStrategies(visitorId: string): Promise<StrategyRow[]> {
  const [rows] = await db().query(
    `SELECT s.version, s.params, s.source, s.source_review_id, r.round_no AS source_round_no, v.created_sim AS source_sim, s.changes, s.created_at
     FROM strategies s LEFT JOIN reviews v ON v.id = s.source_review_id LEFT JOIN rounds r ON r.id = v.round_id
     WHERE s.visitor_id = ? ORDER BY s.version DESC`,
    [visitorId],
  );
  return (rows as StrategyRow[]).map(r => ({ ...r, params: { ...DEFAULTS, ...r.params } }));
}
