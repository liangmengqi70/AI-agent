import 'server-only';
// 模拟器的数据库部分：投递时写入预定事件；推进时间时释放到期事件，并执行"7 天无回应"规则
import type { PoolConnection } from 'mysql2/promise';
import { transaction } from '@/db/pool';
import type { ProfileData } from '@/domain/profile';
import type { HiddenTruth } from './types';
import { planOutcome } from './outcome';
import { addDays } from './rng';

export const NO_RESPONSE_DAYS = 7;
const STATUS_OF: Record<string, string> = { exam_notice: 'exam', interview: 'interview', offer: 'offer', rejected: 'rejected' };

type JobRow = { id: string; company: string; title: string; job_type: string; days_per_week: number | null; months: number | null; hidden: HiddenTruth };

/** 投递成功后调用（与投递在同一个事务中）：为每个投递预先决定结果路径 */
export async function planApplications(c: PoolConnection, visitorId: string, apps: Array<{ applicationId: string; jobId: string }>, candidate: ProfileData, appliedSim: string) {
  if (!apps.length) return;
  const [rows] = await c.query(
    `SELECT j.id, j.company, j.title, j.job_type, j.days_per_week, j.months, t.hidden
     FROM jobs j JOIN job_truths t ON t.job_id = j.id WHERE j.id IN (?)`,
    [apps.map(a => a.jobId)],
  );
  const jobs = new Map((rows as JobRow[]).map(r => [String(r.id), r]));
  const [clock] = await c.query('SELECT seed FROM sim_clocks WHERE visitor_id = ?', [visitorId]);
  const seedBase = (clock as Array<{ seed: string | null }>)[0]?.seed ?? visitorId; // 对照实验时两组共用同一个种子
  const values: unknown[][] = [];
  for (const a of apps) {
    const j = jobs.get(String(a.jobId));
    if (!j) continue;
    const events = planOutcome({
      truth: j.hidden, candidate, appliedSim, seed: `${seedBase}:${a.jobId}`,
      job: { company: j.company, title: j.title, jobType: j.job_type, daysPerWeek: j.days_per_week, months: j.months },
    });
    for (const e of events) values.push([a.applicationId, e.type, e.simDate, e.message]);
  }
  if (values.length) await c.query('INSERT INTO sim_planned_events (application_id, type, sim_date, message) VALUES ?', [values]);
}

export type AdvanceResult = { from: string; to: string; released: Array<{ applicationId: string; type: string }>; noResponse: number };

/** 推进模拟时间：到期的预定事件写入投递事件，并更新投递状态 */
export async function advanceClock(visitorId: string, days: number): Promise<AdvanceResult> {
  return transaction(async c => {
    const [clock] = await c.query('SELECT current_sim FROM sim_clocks WHERE visitor_id = ? FOR UPDATE', [visitorId]);
    const from = (clock as Array<{ current_sim: string }>)[0]?.current_sim;
    if (!from) throw new Error('模拟时钟还没有初始化');
    const to = addDays(from, days);
    await c.query('UPDATE sim_clocks SET current_sim = ? WHERE visitor_id = ?', [to, visitorId]);

    const [due] = await c.query(
      `SELECT p.id, p.application_id, p.type, p.sim_date, p.message FROM sim_planned_events p
       JOIN applications a ON a.id = p.application_id
       WHERE a.visitor_id = ? AND p.released = FALSE AND p.sim_date <= ? ORDER BY p.sim_date, p.id`,
      [visitorId, to],
    );
    const released: AdvanceResult['released'] = [];
    for (const e of due as Array<{ id: string; application_id: string; type: string; sim_date: string; message: string | null }>) {
      await c.query('INSERT INTO application_events (application_id, type, sim_date, message, seen) VALUES (?, ?, ?, ?, FALSE)', [e.application_id, e.type, e.sim_date, e.message]);
      await c.query('UPDATE applications SET status = ?, last_event_sim = ? WHERE id = ?', [STATUS_OF[e.type] ?? 'waiting', e.sim_date, e.application_id]);
      await c.query('UPDATE sim_planned_events SET released = TRUE WHERE id = ?', [e.id]);
      released.push({ applicationId: String(e.application_id), type: e.type });
    }

    // 投递后 7 天没有任何消息（且平台上也没有待发生的事件）→ 无回应
    const [silent] = await c.query(
      `SELECT a.id, a.applied_sim FROM applications a
       WHERE a.visitor_id = ? AND a.status = 'waiting' AND DATE_ADD(a.applied_sim, INTERVAL ${NO_RESPONSE_DAYS} DAY) <= ?
         AND NOT EXISTS (SELECT 1 FROM sim_planned_events p WHERE p.application_id = a.id AND p.released = FALSE)
         AND NOT EXISTS (SELECT 1 FROM application_events e WHERE e.application_id = a.id AND e.type <> 'applied')`,
      [visitorId, to],
    );
    for (const a of silent as Array<{ id: string; applied_sim: string }>) {
      const date = addDays(a.applied_sim, NO_RESPONSE_DAYS);
      await c.query("INSERT INTO application_events (application_id, type, sim_date, message, seen) VALUES (?, 'no_response', ?, NULL, FALSE)", [a.id, date]);
      await c.query("UPDATE applications SET status = 'no_response', last_event_sim = ? WHERE id = ?", [date, a.id]);
    }
    return { from, to, released, noResponse: (silent as unknown[]).length };
  });
}
