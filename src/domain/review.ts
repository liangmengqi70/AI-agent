// 复盘相关的纯规则：什么时候复盘、每个投递走到了哪一步、按分组统计
import { daysBetween } from './tiers';

/* ========== 复盘时机 ========== */
export const REVIEW_TIMING = { minResults: 5, resultRatio: 0.6, normalDays: 7, forceDays: 10 };

/**
 * 至少 5 个投递已回复，并且（60% 以上已回复 或 投递满 7 天）；投递满 10 天一定复盘。
 * "已回复"指收到任何回复（笔试通知、面试、拒信、Offer），通过和被拒都算。
 */
export function reviewDue(input: { applied: number; withResult: number; appliedSim: string; simDate: string }) {
  const days = daysBetween(input.appliedSim, input.simDate);
  if (days >= REVIEW_TIMING.forceDays) return true;
  if (input.withResult < REVIEW_TIMING.minResults) return false;
  return input.withResult / Math.max(input.applied, 1) >= REVIEW_TIMING.resultRatio || days >= REVIEW_TIMING.normalDays;
}

/* ========== 每个投递走到了哪一步 ========== */
export type ReviewApp = {
  id: string; roundNo: number; jobId: string; tier: 'rec' | 'con'; status: string; appliedSim: string;
  title: string; company: string; city: string; direction: string; companyType: string; jobType: string;
  events: Array<{ type: string; simDate: string; message: string | null }>;
};
export type Stage = 'pending' | 'no_response' | 'resume_reject' | 'exam' | 'exam_fail' | 'interview' | 'interview_fail' | 'offer';

export function stageOf(a: Pick<ReviewApp, 'events'>): Stage {
  const has = (t: string) => a.events.some(e => e.type === t);
  if (has('offer')) return 'offer';
  if (has('interview')) return has('rejected') ? 'interview_fail' : 'interview';
  if (has('exam_notice')) return has('rejected') ? 'exam_fail' : 'exam';
  if (has('rejected')) return 'resume_reject';
  if (has('no_response')) return 'no_response';
  return 'pending';
}
export const STAGE_CN: Record<Stage, string> = {
  pending: '等待回复', no_response: '无回应', resume_reject: '简历被拒', exam: '笔试中', exam_fail: '笔试未通过',
  interview: '面试中', interview_fail: '面试未通过', offer: 'Offer',
};
export const passedResume = (s: Stage) => ['exam', 'exam_fail', 'interview', 'interview_fail', 'offer'].includes(s);
export const hasResult = (s: Stage) => s !== 'pending' && s !== 'no_response';

/** 去掉大模型偶尔写进文字里的内部编号，如"（投递编号 352）" */
export function stripInternalIds(text: string) {
  return text.replace(/[（(]\s*投递编号[^）)]*[）)]/g, '').replace(/投递编号\s*[\d、,，\s]+/g, '').replace(/\s{2,}/g, ' ').trim();
}

/* ========== 统计 ========== */
export type GroupRow = { key: string; n: number; resumePass: number; resumeReject: number; pending: number; interview: number };
export type ReviewStats = {
  applied: number; withResult: number; pending: number; noResponse: number;
  resumePass: number; resumeReject: number; examInvited: number; examPass: number; examFail: number; examPending: number;
  interview: number; interviewFail: number; interviewPending: number; offer: number;
  groups: Record<'tier' | 'direction' | 'city' | 'companyType' | 'jobType', GroupRow[]>;
};

const TIER_CN: Record<string, string> = { rec: '推荐', con: '可以考虑' };
const COMPANY_CN: Record<string, string> = { big: '大厂', mid: '中型公司', startup: '创业公司', foreign: '外企', outsourcing: '外包' };
const JOBTYPE_CN: Record<string, string> = { daily_intern: '日常实习', summer_intern: '暑期实习', campus: '校招' };
export const groupLabel = (dim: keyof ReviewStats['groups'], key: string) =>
  dim === 'tier' ? TIER_CN[key] ?? key : dim === 'companyType' ? COMPANY_CN[key] ?? key : dim === 'jobType' ? JOBTYPE_CN[key] ?? key : key;

export function computeStats(apps: ReviewApp[]): ReviewStats {
  const st = apps.map(a => ({ a, s: stageOf(a) }));
  const count = (f: (s: Stage) => boolean) => st.filter(x => f(x.s)).length;
  const group = (dim: keyof ReviewStats['groups']): GroupRow[] => {
    const m = new Map<string, GroupRow>();
    for (const { a, s } of st) {
      const key = groupLabel(dim, String(a[dim]));
      const g = m.get(key) ?? { key, n: 0, resumePass: 0, resumeReject: 0, pending: 0, interview: 0 };
      g.n++;
      if (passedResume(s)) g.resumePass++;
      if (s === 'resume_reject') g.resumeReject++;
      if (s === 'pending') g.pending++;
      if (['interview', 'interview_fail', 'offer'].includes(s)) g.interview++;
      m.set(key, g);
    }
    return [...m.values()].sort((x, y) => y.n - x.n);
  };
  return {
    applied: apps.length,
    withResult: count(hasResult),
    pending: count(s => s === 'pending'),
    noResponse: count(s => s === 'no_response'),
    resumePass: count(passedResume),
    resumeReject: count(s => s === 'resume_reject'),
    examInvited: st.filter(x => x.a.events.some(e => e.type === 'exam_notice')).length,
    examPass: st.filter(x => x.a.events.some(e => e.type === 'exam_notice') && ['interview', 'interview_fail', 'offer'].includes(x.s)).length,
    examFail: count(s => s === 'exam_fail'),
    examPending: count(s => s === 'exam'),
    interview: count(s => ['interview', 'interview_fail', 'offer'].includes(s)),
    interviewFail: count(s => s === 'interview_fail'),
    interviewPending: count(s => s === 'interview'),
    offer: count(s => s === 'offer'),
    groups: { tier: group('tier'), direction: group('direction'), city: group('city'), companyType: group('companyType'), jobType: group('jobType') },
  };
}
