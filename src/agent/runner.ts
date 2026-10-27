import 'server-only';
// 执行器：读取轮次当前步骤 → 执行 → 写入结果 → 进入下一步；遇到需要用户的状态就停下。
// 状态全部存在数据库里，服务重启后可以从断点继续。
import { addStep, getRound, lockRound, roundsInStatus, setStatus, setStep, unlockRound } from '@/db/repos/rounds';
import { GENERATE_STEPS, nextStatus, type GenerateStep } from './round-machine';
import { loadContext, type RoundContext } from './context';
import { screen } from './steps/screen';
import { parseJobs } from './steps/parse-jobs';
import { matchJobs } from './steps/match-jobs';
import { assignTiers } from './steps/assign-tiers';
import { arrange } from './steps/arrange';
import { questions } from './steps/questions';
import { listMatches } from '@/db/repos/matches';

const STEPS: Record<GenerateStep, (ctx: RoundContext) => Promise<void>> = {
  screen, parse: parseJobs, match: matchJobs, tiers: assignTiers, arrange, questions,
};

export async function runRound(roundId: string) {
  if (!(await lockRound(roundId))) return; // 已有执行器在处理这一轮
  try {
    const ctx = await loadContext(roundId);
    let round = ctx.round;
    while (round.status === 'generating') {
      const step = (round.current_step ?? GENERATE_STEPS[0]) as GenerateStep;
      await STEPS[step](ctx);
      const next = GENERATE_STEPS[GENERATE_STEPS.indexOf(step) + 1];
      if (next) {
        await setStep(roundId, next);
      } else {
        const shown = (await listMatches(roundId, 'analyzed')).filter(m => m.tier === 'rec' || m.tier === 'con').length;
        await addStep(roundId, 'wait_apply', 'user', '等待你确认', `${shown} 个推荐岗位`, '流程暂停，直到你确认投递。');
        await setStatus(roundId, nextStatus('generating', 'generated'), { step: 'done' });
      }
      round = (await getRound(roundId))!;
    }
  } catch (error) {
    console.error('轮次执行失败', roundId, error);
    const message = error instanceof Error ? error.message : String(error);
    await setStatus(roundId, 'failed', { error: message.slice(0, 480) });
  } finally {
    await unlockRound(roundId);
  }
}

/** 服务启动时调用：继续执行中断的轮次 */
export async function resumePendingRounds() {
  for (const id of await roundsInStatus('generating')) void runRound(id);
}
