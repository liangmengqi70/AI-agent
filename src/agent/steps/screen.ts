import 'server-only';
// 步骤 1（程序）：拉取岗位 → 硬过滤 → 粗筛，结果写入 matches
import { runFunnel, FILTER_REASONS, type FilterReason } from '@/domain/filters';
import { addStep, clearSteps } from '@/db/repos/rounds';
import { clearMatches, clearQuestions, insertMatches } from '@/db/repos/matches';
import { clearDecisions } from '@/db/repos/decisions';
import { applyChannel } from '@/platform';
import type { RoundContext } from '../context';

export async function screen(ctx: RoundContext) {
  const id = ctx.round.id;
  await clearSteps(id, 'screen');
  await clearMatches(id);
  await clearDecisions(id); // 重新生成时，本轮的勾选、跳过和合并提问一并清空
  await clearQuestions(id);

  const jobs = [...(await ctx.jobs()).values()];
  await addStep(id, 'screen', 'code', '拉取岗位', `模拟日期 ${ctx.simDate} 已上线 ${jobs.length} 个岗位`, '通过平台接口获取岗位公开信息（不含隐藏真相）。');

  // 之前轮次投过的岗位、同公司已投满的，不再推荐
  const applied = await applyChannel.list(ctx.round.visitor_id);
  const r = runFunnel(ctx.profile, jobs, {
    simDate: ctx.simDate, sameCompanyLimit: ctx.params.sameCompanyLimit,
    appliedJobIds: new Set(applied.map(a => a.jobId)), companyApplyCount: await applyChannel.countByCompany(ctx.round.visitor_id),
  }, ctx.params.coarseTopN);
  const counts = new Map<FilterReason, number>();
  r.filtered.forEach(f => counts.set(f.reason, (counts.get(f.reason) ?? 0) + 1));
  const reasonText = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${FILTER_REASONS[k]} ${n}`).join(' · ');
  await addStep(id, 'screen', 'code', '硬过滤', `${jobs.length} → ${jobs.length - r.filtered.length}`, reasonText);
  const ext = r.selected.filter(s => s.kind === 'extended').length;
  await addStep(id, 'screen', 'code', '粗筛', `${jobs.length - r.filtered.length} → ${r.selected.length}`,
    `按方向和技能重合度排序，取前 ${ctx.params.coarseTopN} 个交给大模型逐条分析${ext ? `；其中 ${ext} 个来自 AI 推测的延伸方向` : ''}。`);

  await insertMatches(id, [
    ...r.filtered.map(f => ({ jobId: f.job.id, stage: 'filtered' as const, reason: FILTER_REASONS[f.reason] })),
    ...r.coarseOut.map(j => ({ jobId: j.id, stage: 'coarse_out' as const, reason: '技能、方向重合度较低（粗筛）' })),
    ...r.selected.map(s => ({ jobId: s.job.id, stage: 'analyzed' as const, meta: { kind: s.kind, skillHits: s.skillHits } })),
  ]);
}
