import 'server-only';
// 每一步执行时需要的上下文：轮次、画像、策略、模拟日期、本轮可见的岗位
import { getRound, type RoundRow } from '@/db/repos/rounds';
import { getProfileVersion } from '@/db/repos/profiles';
import { getStrategy } from '@/db/repos/strategies';
import { jobSource, type PublicJob } from '@/platform';
import type { ProfileData } from '@/domain/profile';
import type { StrategyParams } from '@/domain/config';

export type RoundContext = {
  round: RoundRow;
  profile: ProfileData;
  params: StrategyParams;
  simDate: string;
  jobs: () => Promise<Map<string, PublicJob>>;
};

export async function loadContext(roundId: string): Promise<RoundContext> {
  const round = await getRound(roundId);
  if (!round) throw new Error(`轮次不存在：${roundId}`);
  const profile = await getProfileVersion(round.visitor_id, round.profile_version);
  if (!profile) throw new Error('找不到这一轮使用的画像版本');
  const params = await getStrategy(round.visitor_id, round.strategy_version);
  let cache: Map<string, PublicJob> | null = null;
  return {
    round, profile, params, simDate: round.started_sim,
    jobs: async () => (cache ??= new Map((await jobSource.listReleased(round.started_sim)).map(j => [j.id, j]))),
  };
}

/** 有限并发执行（大模型调用用，避免一次发出太多请求） */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}
