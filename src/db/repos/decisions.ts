import 'server-only';
import { db } from '../pool';

// 用户在推荐页的选择 recommendation_decisions：投递 / 跳过 / 未处理
export type Decision = { job_id: string; decision: 'selected' | 'skipped' | 'untouched'; skip_quick: string[] | null; skip_note: string | null };

export async function listDecisions(roundId: string): Promise<Decision[]> {
  const [rows] = await db().query('SELECT job_id, decision, skip_quick, skip_note FROM recommendation_decisions WHERE round_id = ?', [roundId]);
  return rows as Decision[];
}

/** 生成推荐后写入默认选择：推荐档 + 预选的探索岗位为"投递"，其余"未处理"。已有选择的岗位不覆盖。 */
export async function initDecisions(roundId: string, items: Array<{ jobId: string; selected: boolean }>) {
  if (!items.length) return;
  await db().query(
    'INSERT IGNORE INTO recommendation_decisions (round_id, job_id, decision) VALUES ?',
    [items.map(i => [roundId, i.jobId, i.selected ? 'selected' : 'untouched'])],
  );
}

export async function clearDecisions(roundId: string) {
  await db().query('DELETE FROM recommendation_decisions WHERE round_id = ?', [roundId]);
}

export async function setDecision(roundId: string, jobId: string, decision: Decision['decision'], quick: string[] | null = null, note: string | null = null) {
  await db().query(
    `INSERT INTO recommendation_decisions (round_id, job_id, decision, skip_quick, skip_note) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE decision = VALUES(decision), skip_quick = VALUES(skip_quick), skip_note = VALUES(skip_note)`,
    [roundId, jobId, decision, quick ? JSON.stringify(quick) : null, note],
  );
}
