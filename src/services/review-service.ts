import 'server-only';
// 复盘相关的业务操作：判断是否开始复盘、复盘页数据、采纳 / 不采纳、生成新策略并开始下一轮
import { after } from 'next/server';
import { UserFacingError } from '@/lib/api';
import { applyChannel, simClock } from '@/platform';
import { hasResult, reviewDue, REVIEW_TIMING, stageOf, stripInternalIds as clean } from '@/domain/review';
import { applyChanges, describeChange, type ChangeSpec } from '@/domain/guardrails';
import { daysBetween } from '@/domain/tiers';
import { addStep, createRound, currentRound, listRounds, setStatus, type RoundRow } from '@/db/repos/rounds';
import { getReviewByRound, listProposals, markDecided, setProposalDecision } from '@/db/repos/reviews';
import { createStrategy, getStrategy, latestStrategy, type StrategyChange } from '@/db/repos/strategies';
import { createConfirmedVersion, getProfileRow, latestConfirmedVersion } from '@/db/repos/profiles';
import { GENERATE_STEPS, nextStatus } from '@/agent/round-machine';
import { runReview } from '@/agent/review-runner';
import { runRound } from '@/agent/runner';

/** 本轮投递的结果进度（复盘条件用） */
async function roundProgress(visitorId: string, round: RoundRow) {
  const apps = (await applyChannel.list(visitorId)).filter(a => a.roundId === round.id);
  const withResult = apps.filter(a => hasResult(stageOf(a))).length;
  const { date } = await simClock.current(visitorId);
  return { applied: apps.length, withResult, days: round.applied_sim ? daysBetween(round.applied_sim, date) : 0, date };
}

/** 推进时间后调用：满足复盘条件就开始复盘（后台执行） */
export async function maybeStartReview(visitorId: string) {
  const round = await currentRound(visitorId);
  if (!round || round.status !== 'tracking' || !round.applied_sim) return false;
  const p = await roundProgress(visitorId, round);
  if (!reviewDue({ applied: p.applied, withResult: p.withResult, appliedSim: round.applied_sim, simDate: p.date })) return false;
  await setStatus(round.id, nextStatus('tracking', 'reviewStart'));
  await addStep(round.id, 'review_start', 'code', '满足复盘条件',
    `${p.applied} 个投递中 ${p.withResult} 个已回复，投递已 ${p.days} 天`,
    `条件：至少 ${REVIEW_TIMING.minResults} 个已回复（通过或被拒都算），并且 ${Math.round(REVIEW_TIMING.resultRatio * 100)}% 以上已回复或投递满 ${REVIEW_TIMING.normalDays} 天；满 ${REVIEW_TIMING.forceDays} 天一定复盘。`);
  after(() => runReview(round.id));
  return true;
}

/* ========== 复盘页 ========== */
export async function reviewView(visitorId: string, roundNo?: number) {
  const rounds = await listRounds(visitorId);
  if (!rounds.length) return null;
  const current = rounds[rounds.length - 1];
  const target = rounds.find(r => r.round_no === roundNo) ?? [...rounds].reverse().find(r => ['reviewing', 'awaiting_review_decision', 'completed'].includes(r.status)) ?? current;
  const tabs = [];
  for (const r of rounds) tabs.push({ no: r.round_no, hasReview: !!(await getReviewByRound(r.id)) });

  const review = await getReviewByRound(target.id);
  // 早期保存的复盘缺少笔试 / 面试未通过的统计：按当时的投递和复盘日期之前的事件补算（不改变当时的结论）
  if (review?.stats && review.stats.interviewFail === undefined) {
    const { appIds, asOf } = review.stats;
    const apps = (await applyChannel.list(visitorId)).filter(a => appIds.includes(a.id))
      .map(a => stageOf({ events: a.events.filter(e => e.simDate <= asOf) }));
    Object.assign(review.stats, {
      examFail: apps.filter(s => s === 'exam_fail').length,
      interviewFail: apps.filter(s => s === 'interview_fail').length,
      interviewPending: apps.filter(s => s === 'interview').length,
    });
  }
  const params = await getStrategy(visitorId, target.strategy_version);
  const proposals = review ? await listProposals(review.id) : [];
  const progress = target.status === 'tracking' ? await roundProgress(visitorId, target) : null;
  const latest = await latestStrategy(visitorId);
  return {
    tabs, roundNo: target.round_no, roundStatus: target.status, strategyVersion: target.strategy_version,
    nextStrategyVersion: (latest?.version ?? target.strategy_version) + 1,
    progress: progress && { ...progress, timing: REVIEW_TIMING },
    review: review && { status: review.status, stats: review.stats, findings: (review.findings?.items ?? []).map(f => ({ ...f, title: clean(f.title), detail: clean(f.detail) })), error: review.findings?.error ?? null, createdSim: review.created_sim },
    proposals: proposals.map(p => ({
      id: p.id, seq: p.seq, kind: p.kind, title: clean(p.title), basisLabel: p.basis_label,
      evidence: { ...p.evidence, bullets: p.evidence.bullets.map(clean), cautions: p.evidence.cautions.map(clean), tip: p.evidence.tip && clean(p.evidence.tip) },
      notes: p.guard_result?.notes ?? [], weak: p.guard_result?.weak ?? false, decision: p.decision, changeText: describeChange(p.change_spec, params),
      change: p.change_spec,
    })),
  };
}

async function awaitingReview(visitorId: string) {
  const round = await currentRound(visitorId);
  if (!round || round.status !== 'awaiting_review_decision') throw new UserFacingError('当前没有待处理的复盘建议', 409);
  const review = await getReviewByRound(round.id);
  if (!review) throw new UserFacingError('找不到本轮复盘', 404);
  return { round, review };
}

export async function decideProposal(visitorId: string, proposalId: string, decision: 'accepted' | 'rejected' | 'pending') {
  const { review } = await awaitingReview(visitorId);
  if (!(await setProposalDecision(review.id, proposalId, decision))) throw new UserFacingError('找不到这条建议，请刷新页面', 404);
  return { ok: true };
}

/** 处理完建议：采纳的生成新策略（偏好类改画像），完成本轮并开始下一轮 */
export async function finishReviewAndStartNext(visitorId: string) {
  const { round, review } = await awaitingReview(visitorId);
  const proposals = await listProposals(review.id);
  if (proposals.some(p => p.decision === 'pending')) throw new UserFacingError('还有建议没有处理');
  const accepted = proposals.filter(p => p.decision === 'accepted');

  let strategyVersion = (await latestStrategy(visitorId))!.version;
  let profileVersion = await latestConfirmedVersion(visitorId);
  if (accepted.length) {
    const base = await getStrategy(visitorId, strategyVersion);
    const prof = (await getProfileRow(visitorId, profileVersion))!;
    const specs: ChangeSpec[] = accepted.map(p => p.change_spec);
    const r = applyChanges(base, prof.data, specs, round.round_no);
    if (r.profileChanged) {
      const sources = { ...prof.sources };
      for (const s of specs) {
        if (s.type === 'remove_city') sources['prefs.cities'] = { source: 'user' };
        if (s.type === 'promote_direction' || s.type === 'exclude_direction') sources['prefs.directions'] = { source: 'user' };
      }
      profileVersion = await createConfirmedVersion(visitorId, r.profile, sources);
    }
    const changes: StrategyChange[] = proposals.map(p => ({ text: describeChange(p.change_spec, base), accepted: p.decision === 'accepted', kind: p.kind }));
    strategyVersion = await createStrategy(visitorId, r.params, review.id, changes);
  }
  await markDecided(review.id);
  await setStatus(round.id, nextStatus('awaiting_review_decision', 'finish'));
  await addStep(round.id, 'review_decide', 'user', '处理复盘建议',
    proposals.length ? `采纳 ${accepted.length} 条，${proposals.length - accepted.length} 条未采纳` : '本轮没有调整',
    accepted.length ? `生成策略 v${strategyVersion}：${accepted.map(p => p.title).join('；')}` : '沿用当前策略');

  const { date } = await simClock.current(visitorId);
  const nextId = await createRound(visitorId, round.round_no + 1, profileVersion, strategyVersion, date, GENERATE_STEPS[0]);
  after(() => runRound(nextId));
  return { roundNo: round.round_no + 1, strategyVersion, changed: accepted.length > 0 };
}
