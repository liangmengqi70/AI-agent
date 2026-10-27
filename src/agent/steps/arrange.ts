import 'server-only';
// 步骤 5（程序）：同档排序，并按探索比例预选"可以考虑"中排在前面的岗位
import { compareKeys, exploreCount } from '@/domain/tiers';
import { addStep, clearSteps } from '@/db/repos/rounds';
import { listMatches, updateMatch } from '@/db/repos/matches';
import { initDecisions } from '@/db/repos/decisions';
import type { RoundContext } from '../context';

export async function arrange(ctx: RoundContext) {
  const id = ctx.round.id;
  await clearSteps(id, 'arrange');
  const all = await listMatches(id, 'analyzed');
  const byKeys = (a: typeof all[number], b: typeof all[number]) => compareKeys(a.sort_keys?.keys ?? [], b.sort_keys?.keys ?? []);
  const rec = all.filter(m => m.tier === 'rec').sort(byKeys);
  const con = all.filter(m => m.tier === 'con').sort(byKeys);
  const n = exploreCount(rec.length, con.length, ctx.params.exploreRatio);
  for (const [i, m] of con.entries()) await updateMatch(id, m.job_id, { is_explore: i < n });
  // 默认选择：推荐档全部 + 预选的探索岗位勾选投递，其余"未处理"（已有选择的不覆盖）
  await initDecisions(id, [...rec.map(m => ({ jobId: m.job_id, selected: true })), ...con.map((m, i) => ({ jobId: m.job_id, selected: i < n }))]);
  await addStep(id, 'arrange', 'code', '排序与配比', `探索比例 ${Math.round(ctx.params.exploreRatio * 100)}%，预选 ${n} 个探索岗位`,
    '同档排序：7 天内截止 > 部分满足的必须项少 > 首选城市 > 加分项满足多 > 发布时间新。');
}
