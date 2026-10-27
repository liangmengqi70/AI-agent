import 'server-only';
// 步骤 4（程序）：按规则判定"推荐 / 可以考虑 / 不推荐"。同样的输入，结果一定相同。
import { assignTier, checkConstraints, sortKeys } from '@/domain/tiers';
import { directionKind } from '@/domain/filters';
import { addStep, clearSteps } from '@/db/repos/rounds';
import { listMatches, updateMatch } from '@/db/repos/matches';
import type { RoundContext } from '../context';

export async function assignTiers(ctx: RoundContext) {
  const id = ctx.round.id;
  await clearSteps(id, 'tiers');
  const jobs = await ctx.jobs();
  const targets = (await listMatches(id, 'analyzed')).filter(m => m.judgments);
  const count = { rec: 0, con: 0, no: 0 };
  const noReasons = new Map<string, number>();
  for (const m of targets) {
    const job = jobs.get(m.job_id)!;
    const t = assignTier(m.judgments!, checkConstraints(ctx.profile, job), directionKind(ctx.profile, job), ctx.params);
    count[t.tier]++;
    if (t.tier === 'no') noReasons.set(t.why.split('：')[0], (noReasons.get(t.why.split('：')[0]) ?? 0) + 1);
    const summary = m.sort_keys?.summary ?? '';
    await updateMatch(id, m.job_id, {
      tier: t.tier,
      reason: t.tier === 'no' ? t.why : `${t.why}。${summary}`,
      meta: { ...(m.sort_keys ?? {}), flags: t.flags, keys: sortKeys(m.judgments!, job, ctx.profile, ctx.simDate) },
    });
  }
  await addStep(id, 'tiers', 'code', '判定档位', `推荐 ${count.rec} · 可以考虑 ${count.con} · 不推荐 ${count.no}`,
    `档位由程序按规则判定，同样的输入结果一致。${count.no ? `不推荐原因：${[...noReasons.entries()].map(([k, n]) => `${k} ${n}`).join(' · ')}` : ''}`);
}
