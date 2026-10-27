import 'server-only';
import { db } from '../pool';
import type { ReviewStats } from '@/domain/review';
import type { ChangeSpec, ProposalKind } from '@/domain/guardrails';

// 复盘 reviews、调整建议 review_proposals、工具调用 agent_tool_calls
export type Finding = { type: 'problem' | 'preference' | 'normal'; title: string; detail: string; proposals: number[] };
export type ReviewRow = {
  id: string; round_id: string; status: 'running' | 'ready' | 'decided' | 'failed';
  stats: (ReviewStats & { appIds: string[]; pendingIds: string[]; asOf: string }) | null;
  findings: { items: Finding[]; error?: string } | null; created_sim: string;
};
export type ProposalEvidence = { bullets: string[]; cautions: string[]; tip: string | null; appIds: string[] };
export type GuardRecord = { notes: string[]; weak: boolean; original: ChangeSpec };
export type ProposalRow = {
  id: string; review_id: string; seq: number; kind: ProposalKind; title: string; evidence: ProposalEvidence;
  basis_label: string; change_spec: ChangeSpec; guard_result: GuardRecord | null; decision: 'pending' | 'accepted' | 'rejected';
};

const COLS = 'id, round_id, status, stats, findings, created_sim';

export async function getReviewByRound(roundId: string): Promise<ReviewRow | null> {
  const [rows] = await db().query(`SELECT ${COLS} FROM reviews WHERE round_id = ?`, [roundId]);
  return (rows as ReviewRow[])[0] ?? null;
}

/** 开始复盘：已有记录时清掉上次（中途失败）留下的建议和工具调用，重新开始 */
export async function startReview(roundId: string, simDate: string): Promise<string> {
  await db().query("INSERT IGNORE INTO reviews (round_id, status, created_sim) VALUES (?, 'running', ?)", [roundId, simDate]);
  const r = (await getReviewByRound(roundId))!;
  await db().query('DELETE FROM review_proposals WHERE review_id = ?', [r.id]);
  await db().query('DELETE FROM agent_tool_calls WHERE review_id = ?', [r.id]);
  await db().query("UPDATE reviews SET status = 'running', findings = NULL WHERE id = ?", [r.id]);
  return r.id;
}

export async function saveStats(reviewId: string, stats: ReviewRow['stats']) {
  await db().query('UPDATE reviews SET stats = ? WHERE id = ?', [JSON.stringify(stats), reviewId]);
}
export async function finishReview(reviewId: string, status: 'ready' | 'failed', findings: ReviewRow['findings']) {
  await db().query('UPDATE reviews SET status = ?, findings = ? WHERE id = ?', [status, JSON.stringify(findings), reviewId]);
}
export async function markDecided(reviewId: string) {
  await db().query("UPDATE reviews SET status = 'decided', decided_at = NOW() WHERE id = ?", [reviewId]);
}

/** 访客最近一次复盘（早于指定轮次），用于把"仍在等待"的投递计入下一次复盘 */
export async function previousReview(visitorId: string, beforeRoundNo: number): Promise<ReviewRow | null> {
  const [rows] = await db().query(
    `SELECT v.id, v.round_id, v.status, v.stats, v.findings, v.created_sim FROM reviews v JOIN rounds r ON r.id = v.round_id
     WHERE r.visitor_id = ? AND r.round_no < ? ORDER BY r.round_no DESC LIMIT 1`,
    [visitorId, beforeRoundNo],
  );
  return (rows as ReviewRow[])[0] ?? null;
}

/* ---------- 调整建议 ---------- */
export async function addProposal(reviewId: string, p: Omit<ProposalRow, 'id' | 'review_id' | 'seq' | 'decision'>): Promise<number> {
  const [rows] = await db().query('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM review_proposals WHERE review_id = ?', [reviewId]);
  const seq = Number((rows as Array<{ n: number }>)[0].n);
  await db().query(
    'INSERT INTO review_proposals (review_id, seq, kind, title, evidence, basis_label, change_spec, guard_result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [reviewId, seq, p.kind, p.title.slice(0, 200), JSON.stringify(p.evidence), p.basis_label, JSON.stringify(p.change_spec), JSON.stringify(p.guard_result)],
  );
  return seq;
}
export async function listProposals(reviewId: string): Promise<ProposalRow[]> {
  const [rows] = await db().query(
    'SELECT id, review_id, seq, kind, title, evidence, basis_label, change_spec, guard_result, decision FROM review_proposals WHERE review_id = ? ORDER BY seq',
    [reviewId],
  );
  return rows as ProposalRow[];
}
export async function setProposalDecision(reviewId: string, proposalId: string, decision: ProposalRow['decision']) {
  const [r] = await db().query(
    'UPDATE review_proposals SET decision = ?, decided_at = IF(? = \'pending\', NULL, NOW()) WHERE id = ? AND review_id = ?',
    [decision, decision, proposalId, reviewId],
  );
  return (r as { affectedRows: number }).affectedRows > 0;
}

/* ---------- 工具调用记录 ---------- */
export async function addToolCall(reviewId: string, seq: number, tool: string, args: unknown, resultSummary: string, plainText: string) {
  await db().query(
    'INSERT INTO agent_tool_calls (review_id, seq, tool, args, result_summary, plain_text) VALUES (?, ?, ?, ?, ?, ?)',
    [reviewId, seq, tool, JSON.stringify(args ?? {}), resultSummary.slice(0, 4000), plainText.slice(0, 300)],
  );
}
export async function listToolCalls(reviewId: string) {
  const [rows] = await db().query('SELECT seq, tool, plain_text, result_summary, created_at FROM agent_tool_calls WHERE review_id = ? ORDER BY seq', [reviewId]);
  return rows as Array<{ seq: number; tool: string; plain_text: string; result_summary: string; created_at: string }>;
}
