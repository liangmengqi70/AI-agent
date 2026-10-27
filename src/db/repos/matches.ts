import 'server-only';
import { db } from '../pool';
import type { Judgment, Tier } from '@/domain/tiers';
import type { JobRequirements } from '@/llm/tasks/parse-job';

// 每轮每个岗位的结论 matches，以及岗位要求解析缓存 job_parses
export type MatchStage = 'filtered' | 'coarse_out' | 'analyzed' | 'failed';
export type MatchMeta = { kind?: string | null; skillHits?: number; flags?: string[]; keys?: number[]; summary?: string };
export type MatchRow = {
  job_id: string; stage: MatchStage; filter_reason: string | null; judgments: Judgment[] | null;
  tier: Tier | null; reason: string | null; risk: string | null; is_explore: number; sort_keys: MatchMeta | null;
};

export async function clearMatches(roundId: string) {
  await db().query('DELETE FROM matches WHERE round_id = ?', [roundId]);
}

export async function insertMatches(roundId: string, rows: Array<{ jobId: string; stage: MatchStage; reason?: string | null; meta?: MatchMeta }>) {
  if (!rows.length) return;
  await db().query(
    'INSERT INTO matches (round_id, job_id, stage, filter_reason, sort_keys) VALUES ?',
    [rows.map(r => [roundId, r.jobId, r.stage, r.reason ?? null, r.meta ? JSON.stringify(r.meta) : null])],
  );
}

export async function listMatches(roundId: string, stage?: MatchStage): Promise<MatchRow[]> {
  const [rows] = await db().query(
    `SELECT job_id, stage, filter_reason, judgments, tier, reason, risk, is_explore, sort_keys FROM matches WHERE round_id = ? ${stage ? 'AND stage = ?' : ''}`,
    stage ? [roundId, stage] : [roundId],
  );
  return rows as MatchRow[];
}

export async function updateMatch(roundId: string, jobId: string, patch: Partial<{ stage: MatchStage; judgments: Judgment[]; tier: Tier | null; reason: string; risk: string | null; is_explore: boolean; meta: MatchMeta }>) {
  const sets: string[] = []; const vals: unknown[] = [];
  if (patch.stage) { sets.push('stage = ?'); vals.push(patch.stage); }
  if (patch.judgments) { sets.push('judgments = ?'); vals.push(JSON.stringify(patch.judgments)); }
  if (patch.tier !== undefined) { sets.push('tier = ?'); vals.push(patch.tier); }
  if (patch.reason !== undefined) { sets.push('reason = ?'); vals.push(patch.reason); }
  if (patch.risk !== undefined) { sets.push('risk = ?'); vals.push(patch.risk); }
  if (patch.is_explore !== undefined) { sets.push('is_explore = ?'); vals.push(patch.is_explore); }
  if (patch.meta) { sets.push('sort_keys = ?'); vals.push(JSON.stringify(patch.meta)); }
  if (!sets.length) return;
  await db().query(`UPDATE matches SET ${sets.join(', ')} WHERE round_id = ? AND job_id = ?`, [...vals, roundId, jobId]);
}

export async function getJobParse(jobId: string, promptVersion: string): Promise<JobRequirements | null> {
  const [rows] = await db().query('SELECT requirements FROM job_parses WHERE job_id = ? AND prompt_version = ?', [jobId, promptVersion]);
  return (rows as Array<{ requirements: JobRequirements }>)[0]?.requirements ?? null;
}
export async function saveJobParse(jobId: string, promptVersion: string, req: JobRequirements) {
  await db().query('REPLACE INTO job_parses (job_id, prompt_version, requirements) VALUES (?, ?, ?)', [jobId, promptVersion, JSON.stringify(req)]);
}

export async function saveQuestion(roundId: string, key: string, jobIds: string[]) {
  await db().query('DELETE FROM questions WHERE round_id = ? AND constraint_key = ?', [roundId, key]);
  await db().query('INSERT INTO questions (round_id, constraint_key, affected_job_ids) VALUES (?, ?, ?)', [roundId, key, JSON.stringify(jobIds)]);
}
export async function clearQuestions(roundId: string) {
  await db().query('DELETE FROM questions WHERE round_id = ?', [roundId]);
}
export async function answerQuestion(id: string, answer: 'accept' | 'reject' | 'keep_only') {
  await db().query('UPDATE questions SET answer = ?, answered_at = NOW() WHERE id = ?', [answer, id]);
}
export async function listQuestions(roundId: string) {
  const [rows] = await db().query('SELECT id, constraint_key, affected_job_ids, answer FROM questions WHERE round_id = ?', [roundId]);
  return rows as Array<{ id: string; constraint_key: string; affected_job_ids: string[]; answer: string | null }>;
}
