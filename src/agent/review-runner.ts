import 'server-only';
// 复盘执行器：统计（程序）→ 推理循环（大模型 + 工具）→ 护栏（程序，在提交建议时执行）→ 整理发现（大模型）
// 失败时降级：只保留统计，用户仍可直接进入下一轮。
import { computeStats, stageOf } from '@/domain/review';
import { addStep, clearSteps, getRound, lockRound, roundsInStatus, setStatus, unlockRound } from '@/db/repos/rounds';
import { addToolCall, finishReview, listProposals, saveStats, startReview } from '@/db/repos/reviews';
import { summarizeReview } from '@/llm/tasks/review-summary';
import { nextStatus } from './round-machine';
import { loadReviewData } from './review/data';
import { runToolLoop } from './tool-loop';
import { REVIEW_TOOLS } from './tools';

export const REVIEW_MAX_STEPS = 10;
export const REVIEW_MAX_PROPOSE = 4; // 收尾阶段最多提交几次（含被护栏退回的）
const LOOP_VERSION = 'review-loop@2';

const SYSTEM = `你是"AI Agent 求职管家"的复盘 Agent，服务对象是找实习 / 校招的大学生。
你的任务：分析这一轮投递的结果，找出结果不理想（或表现好）的原因，并提出能让下一轮推荐更准的策略调整。

你能看到：投递结果和拒信、推荐时对每条岗位要求的判断、用户跳过岗位的原因、策略历史。
你看不到：招聘方的真实偏好。所以每个结论都必须用数据验证，不能猜。

工作方法：
1. 先用 get_round_stats 看整体结果；
2. 用 query_outcomes 按档位、方向、城市等对比，找出明显偏低或偏高的分组；
3. 用 get_rejection_messages、compare_jobs、get_application_detail 验证原因（例如拒信是否反复提到同一项技能）；
4. 用 get_skip_reasons 看用户跳过的原因，可能发现用户没说出口的偏好；
5. 用 check_sample_size 确认证据够不够，用 get_strategy_history 避免和之前的调整来回反复；
6. 找到原因后尽早用 propose_change 提交建议，不要等到最后；证据不足的也可以提，但会被标为"仅供参考"。

常见的对应关系（供参考）：
- 某方向反复因同一项技能被拒 → add_downgrade（以后这类岗位不推荐）；
- 有"不满足"必须项的岗位几乎都被拒 → set_tier_rule 把 maxMissingMustForCon 调低；
- "可以考虑"档整体很差、"推荐"档正常 → 降低 set_explore_ratio；探索岗位表现好 → 提高；
- 延伸方向表现好 → promote_direction；用户反复跳过某城市或方向 → remove_city / exclude_direction。

规则：
- "等待回复"的投递不算失败；"已回复"包括通过和被拒；
- 城市、方向属于用户偏好，只能建议，由用户决定；
- 如果结果正常，可以不提建议；不要为了提建议而提建议；
- evidence 里不要写投递编号，写公司名、岗位名或数量；
- 最多调用 ${REVIEW_MAX_STEPS} 次工具；调查完毕后不再调用工具，用两三句话总结结论。`;

export async function runReview(roundId: string) {
  if (!(await lockRound(roundId))) return;
  let reviewId: string | null = null;
  try {
    const data = await loadReviewData(roundId);
    reviewId = await startReview(roundId, data.simDate);
    for (const s of ['review_stats', 'review_loop', 'review_guard', 'wait_review']) await clearSteps(roundId, s); // 中途失败重跑时清掉旧记录
    const stats = computeStats(data.apps);
    const pendingIds = data.apps.filter(a => stageOf(a) === 'pending').map(a => a.id);
    await saveStats(reviewId, { ...stats, appIds: data.apps.map(a => a.id), pendingIds, asOf: data.simDate });
    await addStep(roundId, 'review_stats', 'code', '统计本轮结果',
      `${stats.applied} 个投递：${stats.withResult} 个已回复，${stats.pending} 个等待回复${stats.noResponse ? `，${stats.noResponse} 个无回应` : ''}`,
      `简历通过 ${stats.resumePass} · 简历被拒 ${stats.resumeReject} · 进入面试 ${stats.interview} · Offer ${stats.offer}。等待回复的投递之后有消息，计入下一次复盘。`);

    const ctx = { data, reviewId, rejections: new Map<string, number>() };
    const { steps, final } = await runToolLoop({
      task: 'review-loop', promptVersion: LOOP_VERSION, system: SYSTEM, tools: REVIEW_TOOLS, ctx, maxSteps: REVIEW_MAX_STEPS, visitorId: data.visitorId,
      user: `第 ${data.round.round_no} 轮复盘开始。模拟日期 ${data.simDate}。请开始调查。`,
      onStep: (s, seq) => addToolCall(reviewId!, seq, s.tool, s.args, JSON.stringify(s.result), s.plain),
      remindAt: 3,
      wrapUp: {
        toolNames: ['propose_change'], maxCalls: REVIEW_MAX_PROPOSE,
        prompt: '调查步数已用完，不能再查询数据。请根据已经看到的证据，用 propose_change 提交建议（最多 3 条，没有就不提），然后用两三句话总结结论。',
      },
    });
    const proposals = await listProposals(reviewId);
    const rejected = steps.filter(s => s.tool === 'propose_change' && (s.result as { 结果?: string })?.结果 !== '已提交');
    const investigated = steps.filter(s => s.phase === 'investigate' && s.tool !== 'propose_change').length;
    await addStep(roundId, 'review_loop', 'llm', '复盘推理', `调查 ${investigated} 步，提出 ${proposals.length} 条建议`,
      steps.map((s, i) => `${'①②③④⑤⑥⑦⑧⑨⑩'[i] ?? `${i + 1}.`} ${s.plain}`).join(' → '));
    await addStep(roundId, 'review_guard', 'code', '护栏检查',
      proposals.length || rejected.length ? `通过 ${proposals.length} 条${rejected.length ? `，退回 ${rejected.length} 次` : ''}` : '没有需要检查的建议',
      [...proposals.flatMap(p => (p.guard_result?.notes ?? []).map(n => `建议 ${p.seq}：${n}`)),
        ...rejected.map(s => `退回：${(s.result as { 原因?: string })?.原因 ?? ''}`)].join('；'));

    const summary = await summarizeReview({
      stats: { 投递: stats.applied, 已回复: stats.withResult, 等待回复: stats.pending, 无回应: stats.noResponse, 简历通过: stats.resumePass, 进入面试: stats.interview, Offer: stats.offer },
      investigation: steps.map((s, i) => `${i + 1}. ${s.plain}：${JSON.stringify(s.result).slice(0, 800)}`).join('\n'),
      proposals: proposals.map(p => ({ seq: p.seq, title: p.title, basis: p.basis_label })),
      conclusion: final,
    }, data.visitorId);
    const seqs = new Set(proposals.map(p => p.seq));
    const items = summary.findings.map(f => ({ ...f, proposals: f.proposals.filter(n => seqs.has(n)) })); // 只保留真实存在的建议编号
    await finishReview(reviewId, 'ready', { items });
    await setStatus(roundId, nextStatus('reviewing', 'reviewReady'));
    await addStep(roundId, 'wait_review', 'user', '等你确认调整建议', proposals.length ? `${proposals.length} 条建议待处理` : '本轮没有需要调整的地方', '流程暂停，直到你处理完复盘建议。');
  } catch (error) {
    console.error('复盘失败', roundId, error);
    const message = error instanceof Error ? error.message : String(error);
    if (reviewId) await finishReview(reviewId, 'failed', { items: [], error: message.slice(0, 300) });
    // 降级：保留统计，用户可以沿用当前策略进入下一轮
    const round = await getRound(roundId);
    if (round?.status === 'reviewing') {
      await setStatus(roundId, nextStatus('reviewing', 'reviewReady'));
      await addStep(roundId, 'wait_review', 'user', '复盘未完成', '本轮未能生成调整建议，可以沿用当前策略开始下一轮', message.slice(0, 200));
    }
  } finally {
    await unlockRound(roundId);
  }
}

/** 服务启动时调用：继续执行中断的复盘 */
export async function resumePendingReviews() {
  for (const id of await roundsInStatus('reviewing')) void runReview(id);
}
