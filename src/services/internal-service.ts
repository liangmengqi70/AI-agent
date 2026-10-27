import 'server-only';
// 内部评估页（只给开发者看）：大模型成本、各轮结果、对照实验报告、单个访客的完整执行记录
import { readFile } from 'node:fs/promises';
import { db } from '@/db/pool';
import { QUOTA } from '@/llm/quota';

/** 开发环境默认开启；生产环境需要 INTERNAL_EVAL_ENABLED=true，且访问时带上 ?key=INTERNAL_EVAL_KEY */
export function internalAccess(key: string | undefined) {
  if (process.env.NODE_ENV !== 'production') return true;
  const secret = process.env.INTERNAL_EVAL_KEY?.trim();
  return process.env.INTERNAL_EVAL_ENABLED === 'true' && !!secret && key === secret;
}

type Num = number | string | null;
const n = (x: Num) => Number(x ?? 0);

/** 价格（元 / 百万 token）可通过环境变量配置；不配置时只显示 token 数 */
const PRICE = { input: Number(process.env.LLM_PRICE_INPUT_PER_M || 0), output: Number(process.env.LLM_PRICE_OUTPUT_PER_M || 0) };
const cost = (i: number, o: number) => (PRICE.input || PRICE.output ? (i * PRICE.input + o * PRICE.output) / 1e6 : null);

export async function costSummary() {
  const [byTask] = await db().query(
    `SELECT task, model, COUNT(*) calls, SUM(ok) ok, SUM(COALESCE(input_tokens,0)) tin, SUM(COALESCE(output_tokens,0)) tout, ROUND(AVG(latency_ms)) ms
     FROM llm_calls WHERE created_at >= NOW() - INTERVAL 30 DAY GROUP BY task, model ORDER BY calls DESC`);
  const [byDay] = await db().query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') day, COUNT(*) calls, SUM(ok) ok, SUM(COALESCE(input_tokens,0)) tin, SUM(COALESCE(output_tokens,0)) tout
     FROM llm_calls GROUP BY day ORDER BY day DESC LIMIT 14`);
  const [errors] = await db().query(
    `SELECT DATE_FORMAT(created_at, '%m-%d %H:%i') at, task, error, COUNT(*) times FROM llm_calls WHERE ok = 0
     GROUP BY DATE_FORMAT(created_at, '%m-%d %H:%i'), task, error ORDER BY MAX(id) DESC LIMIT 15`);
  const [last24] = await db().query('SELECT COUNT(*) n FROM llm_calls WHERE created_at >= NOW() - INTERVAL 1 DAY');
  type Row = { task: string; model: string; calls: Num; ok: Num; tin: Num; tout: Num; ms: Num };
  type DayRow = { day: string; calls: Num; ok: Num; tin: Num; tout: Num };
  return {
    priced: !!(PRICE.input || PRICE.output),
    quota: { global: QUOTA.global(), visitor: QUOTA.visitor(), used24h: n((last24 as Array<{ n: Num }>)[0].n) },
    byTask: (byTask as Row[]).map(r => ({ task: r.task, model: r.model, calls: n(r.calls), ok: n(r.ok), tin: n(r.tin), tout: n(r.tout), ms: n(r.ms), cost: cost(n(r.tin), n(r.tout)) })),
    byDay: (byDay as DayRow[]).map(r => ({ day: r.day, calls: n(r.calls), ok: n(r.ok), tin: n(r.tin), tout: n(r.tout), cost: cost(n(r.tin), n(r.tout)) })),
    errors: errors as Array<{ at: string; task: string; error: string; times: Num }>,
  };
}

/** 各轮投递结果（所有访客合计）：看推荐是否随轮次变准 */
export async function roundEffect() {
  const [rows] = await db().query(
    `SELECT r.round_no, COUNT(DISTINCT r.visitor_id) visitors, COUNT(DISTINCT a.id) applied,
       COUNT(DISTINCT CASE WHEN e.type IN ('exam_notice','interview','offer','rejected') THEN a.id END) replied,
       COUNT(DISTINCT CASE WHEN e.type IN ('exam_notice','interview','offer') THEN a.id END) invited,
       COUNT(DISTINCT CASE WHEN e.type = 'exam_notice' THEN a.id END) exam,
       COUNT(DISTINCT CASE WHEN e.type IN ('interview','offer') THEN a.id END) interview,
       COUNT(DISTINCT CASE WHEN e.type = 'offer' THEN a.id END) offer
     FROM applications a JOIN rounds r ON r.id = a.round_id LEFT JOIN application_events e ON e.application_id = a.id
     GROUP BY r.round_no ORDER BY r.round_no`);
  return (rows as Array<Record<string, Num>>).map(r => ({
    roundNo: n(r.round_no), visitors: n(r.visitors), applied: n(r.applied), replied: n(r.replied), invited: n(r.invited), exam: n(r.exam), interview: n(r.interview), offer: n(r.offer),
  }));
}

export async function experimentReport() {
  try { return await readFile('data/experiments/latest.md', 'utf8'); } catch { return null; }
}

export async function visitorList() {
  const [rows] = await db().query(
    `SELECT v.id, v.kind, v.persona_key, DATE_FORMAT(v.created_at, '%m-%d %H:%i') created, DATE_FORMAT(v.last_seen_at, '%m-%d %H:%i') seen,
       (SELECT MAX(round_no) FROM rounds WHERE visitor_id = v.id) rounds,
       (SELECT status FROM rounds WHERE visitor_id = v.id ORDER BY round_no DESC LIMIT 1) status,
       (SELECT COUNT(*) FROM applications WHERE visitor_id = v.id) apps,
       (SELECT COUNT(*) FROM llm_calls WHERE visitor_id = v.id) calls
     FROM visitors v ORDER BY v.last_seen_at DESC LIMIT 60`);
  return rows as Array<{ id: string; kind: string; persona_key: string | null; created: string; seen: string; rounds: Num; status: string | null; apps: Num; calls: Num }>;
}

/** 单个访客的完整执行记录：每轮的步骤、复盘的工具调用、建议与护栏结果、策略版本 */
export async function visitorDetail(visitorId: string) {
  const [rounds] = await db().query(
    `SELECT id, round_no, status, profile_version, strategy_version, DATE_FORMAT(started_sim, '%Y-%m-%d') started_sim,
       DATE_FORMAT(applied_sim, '%Y-%m-%d') applied_sim, error FROM rounds WHERE visitor_id = ? ORDER BY round_no`, [visitorId]);
  const out = [];
  for (const r of rounds as Array<{ id: string; round_no: number; status: string; profile_version: number; strategy_version: number; started_sim: string; applied_sim: string | null; error: string | null }>) {
    const [steps] = await db().query(
      `SELECT seq, step, actor, title, summary, detail, DATE_FORMAT(COALESCE(finished_at, started_at), '%m-%d %H:%i:%s') at FROM round_steps WHERE round_id = ? ORDER BY seq`, [r.id]);
    const [reviews] = await db().query('SELECT id, status, findings FROM reviews WHERE round_id = ?', [r.id]);
    const review = (reviews as Array<{ id: string; status: string; findings: { items?: Array<{ type: string; title: string; detail: string }>; error?: string } | null }>)[0];
    let tools: unknown[] = [], proposals: unknown[] = [];
    if (review) {
      const [t] = await db().query('SELECT seq, tool, plain_text, args, result_summary FROM agent_tool_calls WHERE review_id = ? ORDER BY seq', [review.id]);
      const [p] = await db().query('SELECT seq, kind, title, basis_label, change_spec, guard_result, decision FROM review_proposals WHERE review_id = ? ORDER BY seq', [review.id]);
      tools = t as unknown[]; proposals = p as unknown[];
    }
    out.push({ ...r, steps, review: review && { status: review.status, findings: review.findings?.items ?? [], error: review.findings?.error ?? null, tools, proposals } });
  }
  const [strategies] = await db().query(
    `SELECT version, source, changes, DATE_FORMAT(created_at, '%m-%d %H:%i') created FROM strategies WHERE visitor_id = ? ORDER BY version`, [visitorId]);
  const [calls] = await db().query(
    `SELECT task, COUNT(*) calls, SUM(ok) ok, SUM(COALESCE(input_tokens,0)) tin, SUM(COALESCE(output_tokens,0)) tout FROM llm_calls WHERE visitor_id = ? GROUP BY task`, [visitorId]);
  return {
    rounds: out as Array<(typeof out)[number] & { steps: Array<{ seq: number; step: string; actor: string; title: string; summary: string | null; detail: string | null; at: string }> }>,
    strategies: strategies as Array<{ version: number; source: string; changes: Array<{ text: string; accepted: boolean }> | null; created: string }>,
    calls: (calls as Array<{ task: string; calls: Num; ok: Num; tin: Num; tout: Num }>).map(c => ({ task: c.task, calls: n(c.calls), ok: n(c.ok), tin: n(c.tin), tout: n(c.tout) })),
  };
}
