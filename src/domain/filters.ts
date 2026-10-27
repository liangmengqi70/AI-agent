// 硬过滤与粗筛（纯函数，不访问数据库）
// 硬过滤：明确不符合的岗位直接排除，并记录原因；粗筛：按方向和技能重合度排序，取前 N 个交给大模型逐条分析。
import type { ProfileData } from './profile';
import type { PublicJob } from './job';

export const FILTER_REASONS = {
  expired: '已过网申截止日期',
  jobType: '求职类型不符',
  gradYear: '届别不符',
  degree: '学历要求不符',
  cityExcluded: '城市在你的"不考虑"列表',
  city: '城市不在意向范围',
  direction: '方向不在意向范围',
  directionExcluded: '方向在你的"不考虑"列表',
  avoid: '公司类型在你的"不考虑"范围（如外包）',
  salary: '薪资低于你的底线',
  applied: '已经投递过',
  sameCompany: '同一公司本季已投满',
} as const;
export type FilterReason = keyof typeof FILTER_REASONS;

export type FilterContext = {
  simDate: string;
  appliedJobIds?: Set<string>;
  companyApplyCount?: Map<string, number>;
  sameCompanyLimit?: number;
};

/** 返回 null 表示通过；否则返回排除原因 */
export function hardFilter(p: ProfileData, job: PublicJob, ctx: FilterContext): FilterReason | null {
  const pref = p.prefs;
  if (job.deadlineSim && job.deadlineSim < ctx.simDate) return 'expired';

  const wantsIntern = pref.jobType === 'intern' || pref.jobType === 'both';
  const wantsCampus = pref.jobType === 'campus' || pref.jobType === 'both';
  const typeOk =
    (job.jobType === 'daily_intern' && wantsIntern && pref.internKinds.includes('daily')) ||
    (job.jobType === 'summer_intern' && wantsIntern && pref.internKinds.includes('summer')) ||
    (job.jobType === 'campus' && wantsCampus);
  if (!typeOk) return 'jobType';

  if (job.gradYear && p.basics.gradYear && job.gradYear !== p.basics.gradYear) return 'gradYear';
  const rank = { 大专: 0, 本科: 1, 硕士: 2, 博士: 3 } as Record<string, number>;
  if (job.degree && p.basics.degree && (rank[job.degree] ?? 1) > (rank[p.basics.degree] ?? 1)) return 'degree';

  const c = pref.cities;
  if (c.excluded.includes(job.city)) return 'cityExcluded';
  if (!c.anyCity && !c.preferred.includes(job.city) && !c.acceptable.includes(job.city)) return 'city';

  const d = pref.directions;
  if (d.excluded.includes(job.direction)) return 'directionExcluded';
  if (!directionKind(p, job)) return 'direction';

  if (job.companyType === 'outsourcing' && pref.avoid.some(a => a.includes('外包'))) return 'avoid';

  const floor = job.salaryUnit === 'day' ? pref.internPayMin : pref.campusPayMin;
  if (floor && job.salaryMax && job.salaryMax < floor) return 'salary';

  if (ctx.appliedJobIds?.has(job.id)) return 'applied';
  if ((ctx.companyApplyCount?.get(job.company) ?? 0) >= (ctx.sameCompanyLimit ?? Infinity)) return 'sameCompany';
  return null;
}

/** 岗位方向与用户的关系：首选 / 可接受 / 延伸（AI 推测）/ 无关（null） */
export type DirectionKind = 'preferred' | 'acceptable' | 'extended';
export function directionKind(p: ProfileData, job: PublicJob): DirectionKind | null {
  const d = p.prefs.directions;
  if (d.preferred.includes(job.direction)) return 'preferred';
  if (d.acceptable.includes(job.direction)) return 'acceptable';
  if (d.extended.includes(job.direction)) return 'extended';
  return null;
}

/** 粗筛打分：只用于排序，不展示给用户 */
export function coarseScore(p: ProfileData, job: PublicJob) {
  const kind = directionKind(p, job);
  const directionLevel = kind === 'preferred' ? 2 : kind === 'acceptable' ? 1 : 0.5;
  const text = job.jdText.toLowerCase();
  const skillHits = p.skills
    .map(s => s.replace(/[（(].*?[)）]/g, '').trim().toLowerCase())
    .filter(s => s.length > 0 && text.includes(s)).length;
  const cityBonus = p.prefs.cities.preferred.includes(job.city) ? 1 : 0;
  return { score: directionLevel * 10 + skillHits * 2 + cityBonus, directionLevel, skillHits, kind };
}

export type FunnelResult = {
  total: number;
  filtered: Array<{ job: PublicJob; reason: FilterReason }>;
  coarseOut: PublicJob[];
  selected: Array<{ job: PublicJob; score: number; skillHits: number; kind: DirectionKind | null }>;
};

/** 完整漏斗：硬过滤 → 粗筛取前 N 个 */
export function runFunnel(p: ProfileData, jobs: PublicJob[], ctx: FilterContext, topN: number): FunnelResult {
  const filtered: FunnelResult['filtered'] = [];
  const passed: FunnelResult['selected'] = [];
  for (const job of jobs) {
    const reason = hardFilter(p, job, ctx);
    if (reason) filtered.push({ job, reason });
    else { const s = coarseScore(p, job); passed.push({ job, score: s.score, skillHits: s.skillHits, kind: s.kind }); }
  }
  // 延伸方向必须至少命中 1 项技能才保留，避免推荐和你技能无关的岗位
  const coarseOut: PublicJob[] = [];
  for (let i = passed.length - 1; i >= 0; i--) if (passed[i].kind === 'extended' && passed[i].skillHits === 0) coarseOut.push(passed.splice(i, 1)[0].job);
  passed.sort((a, b) => b.score - a.score || a.job.id.localeCompare(b.job.id));
  return { total: jobs.length, filtered, selected: passed.slice(0, topN), coarseOut: [...coarseOut, ...passed.slice(topN).map(x => x.job)] };
}
