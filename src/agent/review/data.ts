import 'server-only';
// 复盘需要的数据：本轮投递（含上次复盘时仍在等待的）、推荐时的逐条判断、跳过原因、策略历史。
// 全部来自平台接口和 Agent 自己的记录，拿不到隐藏真相。
import { applyChannel, jobSource, simClock } from '@/platform';
import { getRound, type RoundRow } from '@/db/repos/rounds';
import { getProfileVersion } from '@/db/repos/profiles';
import { getStrategy, listStrategies, type StrategyRow } from '@/db/repos/strategies';
import { listMatches } from '@/db/repos/matches';
import { listDecisions } from '@/db/repos/decisions';
import { listProposals, previousReview } from '@/db/repos/reviews';
import type { ReviewApp } from '@/domain/review';
import type { Judgment } from '@/domain/tiers';
import type { ProfileData } from '@/domain/profile';
import type { StrategyParams } from '@/domain/config';
import type { ChangeSpec } from '@/domain/guardrails';

export type SkipRecord = { title: string; company: string; city: string; direction: string; tier: string; extended: boolean; quick: string[]; note: string | null };

export type ReviewData = {
  round: RoundRow; visitorId: string; simDate: string;
  profile: ProfileData; params: StrategyParams; prevParams: StrategyParams | null; lastAccepted: ChangeSpec[];
  apps: ReviewApp[];                       // 本次复盘的投递
  carriedIds: string[];                    // 其中来自上一轮"仍在等待"的
  judgments: Map<string, Judgment[]>;      // 投递 id → 推荐时的逐条判断
  extendedJobIds: Set<string>;             // 来自延伸方向的岗位
  skips: SkipRecord[];
  strategies: StrategyRow[];
};

export async function loadReviewData(roundId: string): Promise<ReviewData> {
  const round = await getRound(roundId);
  if (!round) throw new Error(`轮次不存在：${roundId}`);
  const visitorId = round.visitor_id;
  const { date } = await simClock.current(visitorId);
  const profile = (await getProfileVersion(visitorId, round.profile_version))!;
  const params = await getStrategy(visitorId, round.strategy_version);
  const prevParams = round.strategy_version > 1 ? await getStrategy(visitorId, round.strategy_version - 1) : null;

  // 上一次复盘时仍在等待的投递，结果出来后计入这一次
  const prev = await previousReview(visitorId, round.round_no);
  const carried = new Set(prev?.stats?.pendingIds ?? []);
  const lastAccepted = prev ? (await listProposals(prev.id)).filter(p => p.decision === 'accepted').map(p => p.change_spec) : [];

  const all = await applyChannel.list(visitorId);
  const scoped = all.filter(a => a.roundId === round.id || carried.has(a.id));
  const jobs = new Map((await jobSource.listReleased(date)).map(j => [j.id, j]));

  const judgments = new Map<string, Judgment[]>();
  const extendedJobIds = new Set<string>();
  for (const rid of new Set(scoped.map(a => a.roundId))) {
    const matches = new Map((await listMatches(rid)).map(m => [m.job_id, m]));
    for (const a of scoped.filter(x => x.roundId === rid)) {
      const m = matches.get(a.jobId);
      judgments.set(a.id, m?.judgments ?? []);
      if (m?.sort_keys?.kind === 'extended') extendedJobIds.add(a.jobId);
    }
  }

  const apps: ReviewApp[] = scoped.map(a => {
    const j = jobs.get(a.jobId)!;
    return {
      id: a.id, roundNo: a.roundNo, jobId: a.jobId, tier: a.tier, status: a.status, appliedSim: a.appliedSim,
      title: j.title, company: j.company, city: j.city, direction: j.direction, companyType: j.companyType, jobType: j.jobType,
      events: a.events.map(e => ({ type: e.type, simDate: e.simDate, message: e.message })),
    };
  });

  // 跳过原因：本轮推荐页上的跳过
  const matches = new Map((await listMatches(round.id)).map(m => [m.job_id, m]));
  const skips: SkipRecord[] = (await listDecisions(round.id)).filter(d => d.decision === 'skipped').map(d => {
    const j = jobs.get(d.job_id); const m = matches.get(d.job_id);
    return {
      title: j?.title ?? '', company: j?.company ?? '', city: j?.city ?? '', direction: j?.direction ?? '',
      tier: m?.tier === 'rec' ? '推荐' : '可以考虑', extended: m?.sort_keys?.kind === 'extended', quick: d.skip_quick ?? [], note: d.skip_note,
    };
  });

  return {
    round, visitorId, simDate: date, profile, params, prevParams, lastAccepted,
    apps, carriedIds: [...carried].filter(id => scoped.some(a => a.id === id)), judgments, extendedJobIds, skips,
    strategies: await listStrategies(visitorId),
  };
}
