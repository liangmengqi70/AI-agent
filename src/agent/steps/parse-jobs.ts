import 'server-only';
// 步骤 2（大模型）：把粗筛选出的岗位要求拆成必须项 / 加分项；已解析过的直接用缓存
import { parseJob, PROMPT_VERSION } from '@/llm/tasks/parse-job';
import { addStep, clearSteps } from '@/db/repos/rounds';
import { getJobParse, listMatches, saveJobParse, updateMatch } from '@/db/repos/matches';
import { mapLimit, type RoundContext } from '../context';

export async function parseJobs(ctx: RoundContext) {
  const id = ctx.round.id;
  await clearSteps(id, 'parse');
  const jobs = await ctx.jobs();
  const targets = await listMatches(id, 'analyzed');
  let cached = 0, failed = 0;
  await mapLimit(targets, 4, async m => {
    if (await getJobParse(m.job_id, PROMPT_VERSION)) { cached++; return; }
    try {
      const req = await parseJob(jobs.get(m.job_id)!.jdText, ctx.round.visitor_id);
      await saveJobParse(m.job_id, PROMPT_VERSION, req);
    } catch (error) {
      failed++;
      await updateMatch(id, m.job_id, { stage: 'failed', reason: '岗位要求解析失败，下一轮重试' });
      console.error('解析岗位失败', m.job_id, error);
    }
  });
  await addStep(id, 'parse', 'llm', '解析岗位要求', `${targets.length} 个岗位，其中 ${cached} 个命中缓存${failed ? `，${failed} 个失败` : ''}`,
    '把每个岗位的任职要求拆成"必须项 / 加分项"；已解析过的岗位直接使用缓存，不重复调用。');
}
