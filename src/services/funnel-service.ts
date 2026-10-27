import 'server-only';
// 岗位漏斗预览（阶段 2）：用当前画像和策略，对模拟平台上已上线的岗位做硬过滤和粗筛。
// 阶段 3 起，Agent 的"生成推荐"步骤会复用同样的 domain 规则。
import { jobSource, simClock } from '@/platform';
import { runFunnel, FILTER_REASONS, type FilterReason } from '@/domain/filters';
import { DEFAULT_STRATEGY_PARAMS } from '@/domain/config';
import { latestProfile } from '@/db/repos/profiles';

export async function previewFunnel(visitorId: string) {
  const profile = await latestProfile(visitorId);
  if (!profile) return null;
  const { date } = await simClock.current(visitorId);
  const jobs = await jobSource.listReleased(date);
  const r = runFunnel(profile.data, jobs, { simDate: date }, DEFAULT_STRATEGY_PARAMS.coarseTopN);
  const reasons = new Map<FilterReason, number>();
  for (const f of r.filtered) reasons.set(f.reason, (reasons.get(f.reason) ?? 0) + 1);
  return {
    simDate: date,
    total: r.total,
    afterFilter: r.total - r.filtered.length,
    selected: r.selected.length,
    reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ reason: FILTER_REASONS[k], n })),
    coarseOut: r.coarseOut.length,
    top: r.selected.map(x => ({ id: x.job.id, title: x.job.title, company: x.job.company, city: x.job.city, direction: x.job.direction, jobType: x.job.jobType, skillHits: x.skillHits, kind: x.kind })),
  };
}
