import 'server-only';
// 步骤 6（程序）：同一个可调整约束（到岗天数 / 实习时长）影响较多岗位时，合并成一次提问
import { checkConstraints } from '@/domain/tiers';
import { addStep, clearSteps } from '@/db/repos/rounds';
import { listMatches, saveQuestion } from '@/db/repos/matches';
import type { RoundContext } from '../context';

export async function questions(ctx: RoundContext) {
  const id = ctx.round.id;
  await clearSteps(id, 'questions');
  const jobs = await ctx.jobs();
  const analyzed = await listMatches(id, 'analyzed');
  const hits: Record<'daysPerWeek' | 'months', string[]> = { daysPerWeek: [], months: [] };
  for (const m of analyzed) {
    for (const c of checkConstraints(ctx.profile, jobs.get(m.job_id)!)) if (c.level !== 'ok') hits[c.key].push(m.job_id);
  }
  // 每轮最多问一次：只问影响岗位最多的那个约束（相同时优先到岗天数）
  const asked: string[] = [];
  const key = (['daysPerWeek', 'months'] as const).reduce((a, b) => (hits[b].length > hits[a].length ? b : a));
  if (hits[key].length >= ctx.params.questionThreshold) {
    await saveQuestion(id, key, hits[key]);
    asked.push(`${key === 'daysPerWeek' ? '到岗天数' : '实习时长'}影响 ${hits[key].length} 个岗位`);
  }
  await addStep(id, 'questions', 'code', '合并提问', asked.length ? asked.join('；') : '没有需要合并提问的约束',
    `同一约束影响 ${ctx.params.questionThreshold} 个及以上岗位时才提问，每轮最多一次。`);
}
