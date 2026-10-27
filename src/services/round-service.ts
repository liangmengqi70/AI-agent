import 'server-only';
// 轮次相关的业务操作：开启第一轮、重试、查询当前进度和推荐结果
import { after } from 'next/server';
import { UserFacingError } from '@/lib/api';
import { simClock, jobSource, applyChannel } from '@/platform';
import { latestConfirmedVersion } from '@/db/repos/profiles';
import { latestStrategy } from '@/db/repos/strategies';
import { addStep, createRound, currentRound, listSteps, restartRound, setStatus } from '@/db/repos/rounds';
import { listMatches } from '@/db/repos/matches';
import { listDecisions } from '@/db/repos/decisions';
import { getStrategy } from '@/db/repos/strategies';
import { describeQuestions } from './apply-service';
import { getReviewByRound, listProposals } from '@/db/repos/reviews';
import { GENERATE_STEPS, nextStatus } from '@/agent/round-machine';
import { runRound } from '@/agent/runner';

/** 画像第一次确认后调用：还没有任何轮次时，开启第 1 轮并在后台生成推荐 */
export async function startFirstRoundIfNeeded(visitorId: string) {
  if (await currentRound(visitorId)) return;
  const profileVersion = await latestConfirmedVersion(visitorId);
  const strategy = await latestStrategy(visitorId);
  if (!profileVersion || !strategy) return;
  const { date } = await simClock.current(visitorId);
  const id = await createRound(visitorId, 1, profileVersion, strategy.version, date, GENERATE_STEPS[0]);
  after(() => runRound(id));
}

/**
 * 画像确认后，决定这次修改用在哪一轮：
 * - 还没有轮次 → 开始第 1 轮
 * - 本轮还没确认投递（或生成失败）→ 用新画像重新生成本轮，勾选和跳过清空
 * - 本轮已经投递 → 本轮不变，用于下一轮
 */
export async function applyProfileChange(visitorId: string, version: number) {
  const round = await currentRound(visitorId);
  if (!round) { await startFirstRoundIfNeeded(visitorId); return { effect: 'first' as const, roundNo: 1 }; }
  if (round.status === 'awaiting_apply' || round.status === 'failed') {
    await restartRound(round.id, version, GENERATE_STEPS[0]);
    await addStep(round.id, 'profile_edit', 'user', '修改画像与偏好', `使用画像 v${version} 重新生成第 ${round.round_no} 轮推荐`, '本轮还没有确认投递，修改直接用于本轮；之前的勾选和跳过已清空。');
    after(() => runRound(round.id));
    return { effect: 'regenerated' as const, roundNo: round.round_no };
  }
  return { effect: 'next_round' as const, roundNo: round.round_no + 1 };
}

/** 生成推荐期间不允许修改画像 */
export async function assertCanEditProfile(visitorId: string) {
  const round = await currentRound(visitorId);
  if (round?.status === 'generating') throw new UserFacingError('Agent 正在生成推荐，完成后再修改', 409);
}

export async function retryRound(visitorId: string) {
  const round = await currentRound(visitorId);
  if (!round || round.status !== 'failed') throw new UserFacingError('当前没有需要重试的轮次');
  await setStatus(round.id, nextStatus('failed', 'retry'));
  after(() => runRound(round.id));
}

/** 总览页 / 顶栏用：当前轮次的状态和步骤 */
export async function roundOverview(visitorId: string) {
  let round = await currentRound(visitorId);
  if (!round) { await startFirstRoundIfNeeded(visitorId); round = await currentRound(visitorId); } // 已确认画像但还没开始的，自动开启第 1 轮
  if (!round) return null;
  const steps = await listSteps(round.id);
  const matches = await listMatches(round.id);
  const count = { rec: 0, con: 0, no: 0 };
  for (const m of matches) if (m.tier) count[m.tier]++;
  const { date } = await simClock.current(visitorId);
  const apps = await applyChannel.list(visitorId);
  const review = round.status === 'awaiting_review_decision' ? await getReviewByRound(round.id) : null;
  const proposals = review ? await listProposals(review.id) : [];
  return {
    review: review && { status: review.status, total: proposals.length, pending: proposals.filter(p => p.decision === 'pending').length },
    apps: { thisRound: apps.filter(a => a.roundId === round.id).length, total: apps.length, unseen: apps.filter(a => a.events.some(e => !e.seen)).length },
    round: { no: round.round_no, status: round.status, step: round.current_step, error: round.error, strategyVersion: round.strategy_version, startedSim: round.started_sim },
    simDate: date,
    count,
    steps: steps.map(s => ({ step: s.step, actor: s.actor, title: s.title, summary: s.summary, detail: s.detail, at: s.finished_at ?? s.started_at })),
  };
}

/** 推荐页用：本轮"推荐"和"可以考虑"的岗位及逐条依据 */
export async function recommendations(visitorId: string) {
  const round = await currentRound(visitorId);
  if (!round) return null;
  const jobs = new Map((await jobSource.listReleased(round.started_sim)).map(j => [j.id, j]));
  const matches = await listMatches(round.id);
  const shown = matches.filter(m => m.stage === 'analyzed' && (m.tier === 'rec' || m.tier === 'con'));
  const hidden = matches.filter(m => !(m.stage === 'analyzed' && (m.tier === 'rec' || m.tier === 'con')));
  const decisions = new Map((await listDecisions(round.id)).map(d => [d.job_id, d]));
  const params = await getStrategy(visitorId, round.strategy_version);
  const reasonCount = new Map<string, number>();
  for (const m of hidden) {
    if (m.stage === 'filtered') continue; // 硬过滤的原因与用户关系不大，只统计数量
    const r = m.tier === 'no' ? (m.reason ?? '').split('：')[0] : m.filter_reason ?? '其他';
    reasonCount.set(r, (reasonCount.get(r) ?? 0) + 1);
  }
  return {
    roundNo: round.round_no, status: round.status, simDate: round.started_sim,
    items: shown.map(m => {
      const j = jobs.get(m.job_id)!;
      return {
        jobId: m.job_id, title: j.title, company: j.company, companyType: j.companyType, city: j.city, direction: j.direction,
        jobType: j.jobType, salary: { min: j.salaryMin, max: j.salaryMax, unit: j.salaryUnit }, daysPerWeek: j.daysPerWeek, months: j.months,
        deadline: j.deadlineSim, tier: m.tier, isExplore: !!m.is_explore, reason: m.reason, risk: m.risk,
        judgments: m.judgments ?? [], flags: m.sort_keys?.flags ?? [], keys: m.sort_keys?.keys ?? [], kind: m.sort_keys?.kind ?? null,
        decision: decisions.get(m.job_id)?.decision ?? 'untouched', skipNote: decisions.get(m.job_id)?.skip_note ?? null,
      };
    }),
    limits: { roundApplyLimit: params.roundApplyLimit, sameCompanyLimit: params.sameCompanyLimit },
    hidden: {
      filtered: hidden.filter(m => m.stage === 'filtered').length,
      reasons: [...reasonCount.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => ({ reason, n })),
    },
    questions: round.status === 'generating' ? [] : await describeQuestions(round),
  };
}
