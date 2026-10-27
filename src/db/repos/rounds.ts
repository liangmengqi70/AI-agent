import 'server-only';
import { db } from '../pool';

// 轮次 rounds 与步骤记录 round_steps
export type RoundStatus = 'generating' | 'awaiting_apply' | 'tracking' | 'reviewing' | 'awaiting_review_decision' | 'completed' | 'failed';
export type RoundRow = {
  id: string; visitor_id: string; round_no: number; profile_version: number; strategy_version: number;
  status: RoundStatus; current_step: string | null; error: string | null; started_sim: string; applied_sim: string | null;
};

const COLS = 'id, visitor_id, round_no, profile_version, strategy_version, status, current_step, error, started_sim, applied_sim';

export async function getRound(id: string): Promise<RoundRow | null> {
  const [rows] = await db().query(`SELECT ${COLS} FROM rounds WHERE id = ?`, [id]);
  return (rows as RoundRow[])[0] ?? null;
}

export async function listRounds(visitorId: string): Promise<RoundRow[]> {
  const [rows] = await db().query(`SELECT ${COLS} FROM rounds WHERE visitor_id = ? ORDER BY round_no`, [visitorId]);
  return rows as RoundRow[];
}

export async function currentRound(visitorId: string): Promise<RoundRow | null> {
  const [rows] = await db().query(`SELECT ${COLS} FROM rounds WHERE visitor_id = ? ORDER BY round_no DESC LIMIT 1`, [visitorId]);
  return (rows as RoundRow[])[0] ?? null;
}

export async function createRound(visitorId: string, roundNo: number, profileVersion: number, strategyVersion: number, startedSim: string, firstStep: string) {
  const [r] = await db().query(
    `INSERT INTO rounds (visitor_id, round_no, profile_version, strategy_version, status, current_step, started_sim)
     VALUES (?, ?, ?, ?, 'generating', ?, ?)`,
    [visitorId, roundNo, profileVersion, strategyVersion, firstStep, startedSim],
  );
  return String((r as { insertId: number }).insertId);
}

/** 执行器占位：成功返回 true；已被其他执行器占用（且未超时）返回 false */
export async function lockRound(id: string): Promise<boolean> {
  const [r] = await db().query(
    'UPDATE rounds SET locked_until = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE id = ? AND (locked_until IS NULL OR locked_until < NOW())',
    [id],
  );
  return (r as { affectedRows: number }).affectedRows > 0;
}
export async function unlockRound(id: string) {
  await db().query('UPDATE rounds SET locked_until = NULL WHERE id = ?', [id]);
}

export async function setProfileVersion(id: string, version: number) {
  await db().query('UPDATE rounds SET profile_version = ? WHERE id = ?', [version, id]);
}
/** 标记为已投递；只有"等你确认投递"状态才能成功（防止重复提交），成功返回 true */
export async function markApplied(id: string, simDate: string): Promise<boolean> {
  const [r] = await db().query("UPDATE rounds SET status = 'tracking', applied_sim = ? WHERE id = ? AND status = 'awaiting_apply'", [simDate, id]);
  return (r as { affectedRows: number }).affectedRows > 0;
}
/** 修改画像后重新生成本轮：换用新画像版本，从第一步重新开始 */
export async function restartRound(id: string, profileVersion: number, firstStep: string) {
  await db().query("UPDATE rounds SET profile_version = ?, status = 'generating', current_step = ?, error = NULL WHERE id = ?", [profileVersion, firstStep, id]);
  await db().query('DELETE FROM round_steps WHERE round_id = ?', [id]);
}

export async function setStep(id: string, step: string) {
  await db().query('UPDATE rounds SET current_step = ? WHERE id = ?', [step, id]);
}
export async function setStatus(id: string, status: RoundStatus, patch: { error?: string | null; step?: string | null } = {}) {
  await db().query('UPDATE rounds SET status = ?, error = ?, current_step = COALESCE(?, current_step) WHERE id = ?',
    [status, patch.error ?? null, patch.step ?? null, id]);
}

export async function roundsInStatus(status: RoundStatus): Promise<string[]> {
  const [rows] = await db().query('SELECT id FROM rounds WHERE status = ?', [status]);
  return (rows as Array<{ id: string }>).map(r => r.id);
}

/* ---------- 步骤记录（总览页"最近动作"，以及内部评估） ---------- */
export type StepRow = { seq: number; step: string; actor: 'code' | 'llm' | 'tool' | 'user'; title: string; summary: string | null; detail: string | null; status: 'running' | 'done' | 'failed'; started_at: string; finished_at: string | null };

/** 开始一个步骤前，先清掉这个步骤上次（如中途失败）留下的记录 */
export async function clearSteps(roundId: string, step: string) {
  await db().query('DELETE FROM round_steps WHERE round_id = ? AND step = ?', [roundId, step]);
}
export async function addStep(roundId: string, step: string, actor: StepRow['actor'], title: string, summary: string, detail = '', status: StepRow['status'] = 'done') {
  const [rows] = await db().query('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM round_steps WHERE round_id = ?', [roundId]);
  const seq = Number((rows as Array<{ n: number }>)[0].n);
  await db().query(
    `INSERT INTO round_steps (round_id, seq, step, actor, title, summary, detail, status, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${status === 'running' ? 'NULL' : 'NOW()'})`,
    [roundId, seq, step, actor, title, summary, detail, status],
  );
}
export async function listSteps(roundId: string): Promise<StepRow[]> {
  const [rows] = await db().query('SELECT seq, step, actor, title, summary, detail, status, started_at, finished_at FROM round_steps WHERE round_id = ? ORDER BY seq', [roundId]);
  return rows as StepRow[];
}
