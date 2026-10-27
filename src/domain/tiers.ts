// 档位判定与排序配比（纯函数）。档位由程序按规则判定，大模型只提供逐条判断。
import type { StrategyParams } from './config';
import type { DirectionKind } from './filters';
import type { PublicJob } from './job';
import type { ProfileData } from './profile';

export type ReqStatus = 'ok' | 'part' | 'no';
export type Judgment = { req: string; kind: 'must' | 'bonus'; status: ReqStatus; evidence: string };
export type Tier = 'rec' | 'con' | 'no';

/** 可调整约束：到岗天数、实习时长。within = 在"通常"和"最多"之间；over = 超出"最多" */
export type ConstraintCheck = { key: 'daysPerWeek' | 'months'; level: 'ok' | 'within' | 'over'; need: number; usual: number | null; max: number | null };

export function checkConstraints(p: ProfileData, job: PublicJob): ConstraintCheck[] {
  const out: ConstraintCheck[] = [];
  const add = (key: ConstraintCheck['key'], need: number | null, usual: number | null, max: number | null) => {
    if (!need || !usual) return;
    const level = need <= usual ? 'ok' : max && need <= max ? 'within' : 'over';
    out.push({ key, level, need, usual, max });
  };
  if (job.jobType !== 'campus') {
    add('daysPerWeek', job.daysPerWeek, p.prefs.daysPerWeek.usual, p.prefs.daysPerWeek.max);
    add('months', job.months, p.prefs.months.usual, p.prefs.months.max);
  }
  return out;
}

export type TierResult = { tier: Tier; why: string; flags: string[] };

/** 按规则判定档位，并给出一句程序生成的理由（如"必须项 4/4 满足，加分项 2/3 满足"） */
export function assignTier(
  judgments: Judgment[], constraints: ConstraintCheck[], kind: DirectionKind | null, params: StrategyParams,
): TierResult {
  const must = judgments.filter(j => j.kind === 'must');
  const bonus = judgments.filter(j => j.kind === 'bonus');
  const mustOk = must.filter(j => j.status === 'ok').length;
  const mustPart = must.filter(j => j.status === 'part').length;
  const bonusOk = bonus.filter(j => j.status === 'ok').length;
  const stat = `必须项 ${mustOk}/${must.length} 满足${mustPart ? `、${mustPart} 项部分满足` : ''}，加分项 ${bonusOk}/${bonus.length} 满足`;
  const flags: string[] = [];

  const missing = must.filter(j => j.status === 'no');
  if (missing.length > params.tierRules.maxMissingMustForCon) return { tier: 'no', why: `必须项不满足：${missing.map(m => m.req).join('、')}`, flags };

  for (const rule of params.downgradeRules) {
    const hit = must.find(j => j.status !== 'ok' && j.req.toLowerCase().includes(rule.keyword.toLowerCase()));
    if (hit) return { tier: 'no', why: `${rule.keyword} 是必须项且你不具备（第 ${rule.fromRound ?? '?'} 轮复盘新规则）`, flags };
  }

  const over = constraints.find(c => c.level === 'over');
  if (over) return { tier: 'no', why: over.key === 'daysPerWeek' ? `需每周到岗 ${over.need} 天，超出你最多可调整的 ${over.max ?? over.usual} 天` : `需实习 ${over.need} 个月，超出你最多可延长的 ${over.max ?? over.usual} 个月`, flags };

  let tier: Tier = 'rec';
  if (missing.length) { flags.push(`有 ${missing.length} 项必须项不满足`); tier = 'con'; }
  const bonusRatio = bonus.length ? bonusOk / bonus.length : 1;
  if (mustPart > params.tierRules.maxPartialMust || bonusRatio < params.tierRules.minBonusRatio) tier = 'con';

  for (const c of constraints.filter(c => c.level === 'within')) {
    flags.push(c.key === 'daysPerWeek' ? `需每周 ${c.need} 天` : `需实习 ${c.need} 个月`);
    tier = 'con';
  }
  if (kind === 'extended') { flags.push('延伸方向'); tier = 'con'; }
  return { tier, why: stat, flags };
}

/** 同档排序用的键：越小越靠前 */
export function sortKeys(judgments: Judgment[], job: PublicJob, p: ProfileData, simDate: string) {
  const dueSoon = job.deadlineSim ? daysBetween(simDate, job.deadlineSim) <= 7 : false;
  return [
    dueSoon ? 0 : 1,
    judgments.filter(j => j.kind === 'must' && j.status === 'part').length,
    p.prefs.cities.preferred.includes(job.city) ? 0 : 1,
    -judgments.filter(j => j.kind === 'bonus' && j.status === 'ok').length,
    -Date.parse(job.releasedSim),
  ];
}
export function compareKeys(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** 探索名额：在全部"推荐"之外，按比例预选"可以考虑"中排在前面的岗位 */
export function exploreCount(recCount: number, conCount: number, ratio: number) {
  if (!conCount) return 0;
  const n = Math.round((Math.max(recCount, 1) * ratio) / (1 - ratio));
  return Math.min(conCount, Math.max(1, n));
}
