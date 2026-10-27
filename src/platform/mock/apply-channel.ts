import 'server-only';
// 模拟投递渠道：投递写入 applications，并记录"已投递"事件。
// 投递之后的结果（笔试、面试、拒信……）由模拟器在投递时预先安排，推进时间时才释放。
import { db, transaction } from '@/db/pool';
import { planApplications } from '@/simulator/events';
import type { ApplyChannel, ApplicationView } from '../apply-types';

type Row = { id: string; round_id: string; round_no: number; job_id: string; tier: 'rec' | 'con'; status: ApplicationView['status']; applied_sim: string; last_event_sim: string | null };
type EventRow = { application_id: string; type: string; sim_date: string; message: string | null; seen: number };

export const mockApplyChannel: ApplyChannel = {
  async submit(visitorId, roundId, items, simDate, candidate) {
    if (!items.length) return 0;
    return transaction(async c => {
      const created: Array<{ applicationId: string; jobId: string }> = [];
      for (const it of items) {
        const [r] = await c.query(
          `INSERT IGNORE INTO applications (visitor_id, round_id, job_id, tier, status, applied_sim, last_event_sim)
           VALUES (?, ?, ?, ?, 'waiting', ?, ?)`,
          [visitorId, roundId, it.jobId, it.tier, simDate, simDate],
        );
        const id = (r as { insertId: number; affectedRows: number });
        if (!id.affectedRows) continue; // 已经投过
        await c.query("INSERT INTO application_events (application_id, type, sim_date, message, seen) VALUES (?, 'applied', ?, NULL, TRUE)", [id.insertId, simDate]);
        created.push({ applicationId: String(id.insertId), jobId: it.jobId });
      }
      await planApplications(c, visitorId, created, candidate, simDate);
      return created.length;
    });
  },

  async list(visitorId) {
    const [rows] = await db().query(
      `SELECT a.id, a.round_id, r.round_no, a.job_id, a.tier, a.status, a.applied_sim, a.last_event_sim
       FROM applications a JOIN rounds r ON r.id = a.round_id WHERE a.visitor_id = ? ORDER BY a.id`,
      [visitorId],
    );
    const apps = rows as Row[];
    if (!apps.length) return [];
    const [evs] = await db().query(
      'SELECT application_id, type, sim_date, message, seen FROM application_events WHERE application_id IN (?) ORDER BY sim_date, id',
      [apps.map(a => a.id)],
    );
    const byApp = new Map<string, ApplicationView['events']>();
    for (const e of evs as EventRow[]) {
      const list = byApp.get(e.application_id) ?? [];
      list.push({ type: e.type, simDate: e.sim_date, message: e.message, seen: !!e.seen });
      byApp.set(e.application_id, list);
    }
    return apps.map(a => ({
      id: a.id, roundId: a.round_id, roundNo: a.round_no, jobId: a.job_id, tier: a.tier, status: a.status,
      appliedSim: a.applied_sim, lastEventSim: a.last_event_sim, events: byApp.get(a.id) ?? [],
    }));
  },

  async countByCompany(visitorId) {
    const [rows] = await db().query(
      'SELECT j.company, COUNT(*) AS n FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.visitor_id = ? GROUP BY j.company',
      [visitorId],
    );
    return new Map((rows as Array<{ company: string; n: number }>).map(r => [r.company, Number(r.n)]));
  },

  async markSeen(visitorId, applicationId) {
    await db().query(
      'UPDATE application_events e JOIN applications a ON a.id = e.application_id SET e.seen = TRUE WHERE a.visitor_id = ? AND a.id = ?',
      [visitorId, applicationId],
    );
  },
};
