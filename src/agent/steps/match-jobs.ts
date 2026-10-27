import 'server-only';
// 步骤 3（大模型）：逐条判断岗位要求是否满足，引用画像中的依据
import { matchJob, profileForMatching } from '@/llm/tasks/match-job';
import { PROMPT_VERSION } from '@/llm/tasks/parse-job';
import { addStep, clearSteps } from '@/db/repos/rounds';
import { getJobParse, listMatches, updateMatch } from '@/db/repos/matches';
import { mapLimit, type RoundContext } from '../context';

export async function matchJobs(ctx: RoundContext) {
  const id = ctx.round.id;
  await clearSteps(id, 'match');
  const jobs = await ctx.jobs();
  // 要分析的：还没有判断结果的，以及上次失败的（重试时只补做这些）
  const all = (await listMatches(id)).filter(m => m.stage === 'analyzed' || m.stage === 'failed');
  const targets = all.filter(m => m.stage === 'failed' || !m.judgments);
  for (const m of targets.filter(x => x.stage === 'failed')) await updateMatch(id, m.job_id, { stage: 'analyzed' });
  const profileText = profileForMatching(ctx.profile);
  let failed = 0;
  let lastError = '';
  let example = '';
  await mapLimit(targets, 4, async m => {
    const req = await getJobParse(m.job_id, PROMPT_VERSION);
    const job = jobs.get(m.job_id)!;
    try {
      if (!req) throw new Error('缺少岗位要求解析结果');
      const r = await matchJob(profileText, job.title, req, ctx.round.visitor_id);
      await updateMatch(id, m.job_id, { judgments: r.judgments, risk: r.risk, meta: { ...(m.sort_keys ?? {}), summary: r.summary } });
      if (!example) {
        const ok = r.judgments.filter(j => j.kind === 'must' && j.status === 'ok').length;
        example = `示例：${job.company} · ${job.title} → 必须项 ${ok}/${r.judgments.filter(j => j.kind === 'must').length} 满足。${r.summary}`;
      }
    } catch (error) {
      failed++;
      lastError = error instanceof Error ? error.message : String(error);
      await updateMatch(id, m.job_id, { stage: 'failed', reason: '逐条匹配失败，下一轮重试' });
      console.error('逐条匹配失败', m.job_id, error);
    }
  });
  // 大部分都失败（如 AI 服务繁忙、余额不足）：本轮标为失败，用户点"重试"时只补做失败的岗位
  if (failed >= 3 && failed * 2 > all.length) throw new Error(`${failed} 个岗位分析失败：${lastError}`);
  await addStep(id, 'match', 'llm', '逐条匹配', `${all.length - failed} 个岗位，每条要求给出判断和简历依据${failed ? `；${failed} 个失败，下一轮重试` : ''}`, example);
}
