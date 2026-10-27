// 结果生成（纯函数）：投递时按"候选人实际情况 × 隐藏真相 × 随机因素"预先决定整条结果路径。
// 概率参数在阶段 7 调整：目标是 Agent 能找到原因，但不是一眼就能看出来。
// 简历关：每个方向有一项"真正卡人"的必须项（truth.keyMust），缺了基本过不了；其他必须项招聘方会放宽，缺一项只降低一些概率。
import type { ProfileData } from '@/domain/profile';
import type { HiddenTruth } from './types';
import { candidateText, checkRequirement } from './candidate';
import { addDays, seeded, type Rng } from './rng';

export type PlannedEvent = { type: 'exam_notice' | 'interview' | 'offer' | 'rejected'; simDate: string; message: string };
export type OutcomeJob = { company: string; title: string; jobType: string; daysPerWeek: number | null; months: number | null };

export const P = {
  resumeBase: 0.62, resumeCompetition: 0.4, keyMissFactor: 0.12, lenientMissFactor: 0.65, citeKey: 0.7, citeOther: 0.3,
  internBonus: 0.1, internPenalty: 0.2, degreeBonus: 0.1, degreePenalty: 0.3,
  constraintFail: 0.8, rejectionSent: 0.75,
  examBase: 0.85, examDifficulty: 0.6, examFit: 0.25,
  interviewBase: 0.25, interviewFit: 0.45, interviewCompetition: 0.25, interviewLuck: 0.2,
};
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const between = (rng: Rng, [a, b]: [number, number]) => rng.int(a, b);

const GENERIC_REJECT = [
  '感谢你对我们的关注。经过慎重评估，你的简历暂未进入下一轮，我们会将你的信息保留在人才库中。',
  '很遗憾，本次你的背景与岗位需求暂不匹配，感谢你的投递。',
  '感谢投递。由于本岗位应聘人数较多，经综合评估，暂时无法安排后续流程。',
];

export function planOutcome(input: { truth: HiddenTruth; job: OutcomeJob; candidate: ProfileData; appliedSim: string; seed: string }): PlannedEvent[] {
  const { truth, job, candidate } = input;
  const rng = seeded(input.seed);
  const c = candidateText(candidate);
  const checks = truth.realMust.map(req => ({ req, r: checkRequirement(req, c) }));
  const hard = checks.filter(x => x.r !== 'soft');
  const missing = hard.filter(x => x.r === 'missing').map(x => x.req);
  const fit = hard.length ? 1 - missing.length / hard.length : 0.8;
  const key = truth.keyMust ?? null;
  const keyMissing = !!key && checkRequirement(key, c) === 'missing';
  const otherMissing = missing.filter(m => m !== key);

  // 不回复：什么事件都没有，7 天后由平台标记为"无回应"
  if (rng.next() > truth.replyRate) return [];

  const events: PlannedEvent[] = [];
  const reject = (date: string, message: string) => { events.push({ type: 'rejected', simDate: date, message }); return events; };
  let t = addDays(input.appliedSim, between(rng, truth.speedDays.resume));

  // 1. 简历筛选
  const usualDays = candidate.prefs.daysPerWeek.usual;
  const usualMonths = candidate.prefs.months.usual;
  const daysGap = job.jobType !== 'campus' && !!job.daysPerWeek && !!usualDays && job.daysPerWeek > usualDays;
  const monthsGap = job.jobType !== 'campus' && !!job.months && !!usualMonths && job.months > usualMonths;
  if ((daysGap || monthsGap) && !truth.daysNegotiable && rng.next() < P.constraintFail) {
    return reject(t, daysGap ? `本岗位需要每周到岗 ${job.daysPerWeek} 天，目前无法调整，很遗憾这次不能继续。` : `本岗位要求实习满 ${job.months} 个月，与你的可实习时长不符，很遗憾这次不能继续。`);
  }
  const degree = candidate.basics.degree;
  let pResume = P.resumeBase - P.resumeCompetition * truth.competition
    + (c.hasInternship ? P.internBonus * truth.internshipPref : -P.internPenalty * truth.internshipPref)
    + (degree === '硕士' || degree === '博士' ? P.degreeBonus * truth.schoolPref : degree === '大专' ? -P.degreePenalty * truth.schoolPref : 0);
  pResume *= P.lenientMissFactor ** otherMissing.length;
  if (keyMissing) pResume *= P.keyMissFactor;
  if (rng.next() > clamp(pResume, 0.03, 0.95)) {
    if (rng.next() > P.rejectionSent) return events; // 有些公司不发拒信
    // 拒信有时写明原因：卡人的那一项更常被点名，其他缺项偶尔提到
    const reason = keyMissing && rng.next() < P.citeKey ? key : otherMissing.length && rng.next() < P.citeOther ? rng.pick(otherMissing) : null;
    return reject(t, reason ? `感谢投递。本岗位比较看重"${reason}"，你的简历中这方面的经历较少，这次暂不进入下一轮。` : rng.pick(GENERIC_REJECT));
  }

  // 2. 笔试 / 测评（部分岗位有）
  if (truth.hasExam) {
    events.push({ type: 'exam_notice', simDate: t, message: `你已通过${job.company}的简历筛选，请在 3 天内完成在线笔试 / 测评。` });
    t = addDays(t, between(rng, truth.speedDays.exam));
    const pExam = clamp(P.examBase - P.examDifficulty * truth.examDifficulty + P.examFit * fit, 0.1, 0.95);
    if (rng.next() > pExam) return reject(t, '你的笔试成绩未达到本岗位的要求，感谢参与。');
  }

  // 3. 面试
  events.push({ type: 'interview', simDate: t, message: `${job.company}邀请你参加「${job.title}」面试，请留意后续的时间确认。` });
  t = addDays(t, between(rng, truth.speedDays.interview));
  const pInterview = clamp(P.interviewBase + P.interviewFit * fit - P.interviewCompetition * truth.competition + P.interviewLuck * (rng.next() - 0.5), 0.05, 0.9);
  if (rng.next() > pInterview) {
    const weak = missing.length ? `面试官认为你在"${rng.pick(missing)}"方面还需要加强。` : '综合评估后，我们选择了与岗位更匹配的候选人。';
    return reject(t, `感谢你参加面试。${weak}`);
  }
  events.push({ type: 'offer', simDate: t, message: `恭喜你通过${job.company}「${job.title}」的面试，我们将发送正式录用通知。` });
  return events;
}
