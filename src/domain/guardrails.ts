// 复盘建议的护栏（纯函数）：大模型负责"想该怎么调"，护栏负责"这样调是否允许"，用户负责"最终要不要调"。
import type { StrategyParams } from './config';
import { DIRECTIONS, type ProfileData } from './profile';

/** 复盘可以提出的调整（结构化，程序能直接执行） */
export type ChangeSpec =
  | { type: 'add_downgrade'; keyword: string }                                   // 规则：必须项含该关键词且你不具备 → 不推荐
  | { type: 'set_explore_ratio'; value: number }                                 // 比例：探索岗位占比
  | { type: 'set_tier_rule'; key: TierRuleKey; value: number }                    // 规则：档位标准
  | { type: 'remove_city'; city: string }                                        // 偏好：移除一个意向城市
  | { type: 'promote_direction'; direction: string }                             // 偏好：延伸方向加入"可接受"
  | { type: 'exclude_direction'; direction: string };                            // 偏好：不再推荐某个方向

export type TierRuleKey = 'maxPartialMust' | 'minBonusRatio' | 'maxMissingMustForCon';
export type ProposalKind = 'rule' | 'ratio' | 'preference';
export const kindOf = (s: ChangeSpec): ProposalKind =>
  s.type === 'set_explore_ratio' ? 'ratio' : s.type === 'add_downgrade' || s.type === 'set_tier_rule' ? 'rule' : 'preference';

// 依据门槛：样本 ≥ 5 算有依据；或者拒信说法高度一致（≥ 3 封）时，样本 ≥ 3 也算有依据
export const GUARD = { minSamples: 5, minConsistent: 2, strongConsistent: 3, minSamplesIfStrong: 3, ratioStep: 0.1, ratioMax: 0.5, bonusStep: 0.25, maxPartialMustMax: 3, maxMissingMustMax: 2 };

export type GuardInput = {
  spec: ChangeSpec;
  params: StrategyParams;
  profile: ProfileData;
  /** 上一个策略版本的参数（没有则为 null），用于检查"来回反复" */
  prevParams: StrategyParams | null;
  /** 上一轮采纳过的调整 */
  lastAccepted: ChangeSpec[];
  /** 程序核实过的证据：引用的投递数、说法一致的拒信数 */
  samples: number;
  consistent: number;
};
export type GuardResult =
  | { verdict: 'reject'; reason: string }
  | { verdict: 'ok'; spec: ChangeSpec; kind: ProposalKind; notes: string[]; basisLabel: string; weak: boolean };

/** 上一轮从 before 调到 now，这次又要调回 next 的方向 */
const reversed = (before: number, now: number, next: number) => before !== now && Math.sign(next - now) === -Math.sign(now - before);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const round2 = (x: number) => Math.round(x * 100) / 100;

export function checkProposal(g: GuardInput): GuardResult {
  const notes: string[] = [];
  let spec = g.spec;
  const p = g.params;
  const dirs = g.profile.prefs.directions;
  const reject = (reason: string): GuardResult => ({ verdict: 'reject', reason });

  switch (spec.type) {
    case 'add_downgrade': {
      const keyword = spec.keyword.trim();
      if (!keyword || keyword.length > 20) return reject('关键词为空或太长，请给出一个具体的技能名，如 Spark');
      if (p.downgradeRules.some(r => r.keyword.toLowerCase() === keyword.toLowerCase())) return reject(`已经有"${keyword}"这条规则了`);
      const own = [...g.profile.skills, ...g.profile.courses].some(s => s.toLowerCase().includes(keyword.toLowerCase()));
      if (own) return reject(`画像中已经有"${keyword}"，这条规则不会生效`);
      spec = { type: 'add_downgrade', keyword };
      break;
    }
    case 'set_explore_ratio': {
      if (!Number.isFinite(spec.value) || spec.value <= 0 || spec.value >= 1) return reject('探索比例必须在 0–1 之间');
      let v = spec.value;
      if (Math.abs(v - p.exploreRatio) > GUARD.ratioStep + 1e-9) {
        const clipped = round2(p.exploreRatio + Math.sign(v - p.exploreRatio) * GUARD.ratioStep);
        notes.push(`Agent 原本建议调到 ${pct(v)}，单轮调整最多 ${pct(GUARD.ratioStep)}，已调整为 ${pct(clipped)}。`);
        v = clipped;
      }
      if (v < p.exploreRatioMin) { notes.push(`Agent 原本建议调到 ${pct(v)}，低于系统设定的下限，已调整为 ${pct(p.exploreRatioMin)}。`); v = p.exploreRatioMin; }
      if (v > GUARD.ratioMax) { notes.push(`探索比例最高 ${pct(GUARD.ratioMax)}，已调整。`); v = GUARD.ratioMax; }
      v = round2(v);
      if (v === round2(p.exploreRatio)) return reject(`探索比例已经是 ${pct(v)}（下限 ${pct(p.exploreRatioMin)}），无法再这样调整`);
      if (g.prevParams && reversed(g.prevParams.exploreRatio, p.exploreRatio, v)) return reject('上一轮刚把探索比例往相反方向调过，来回调整需要更强的证据，这次先不调');
      spec = { type: 'set_explore_ratio', value: v };
      break;
    }
    case 'set_tier_rule': {
      const cur = p.tierRules[spec.key];
      let v = spec.value;
      if (!Number.isFinite(v)) return reject('数值不合法');
      if (spec.key === 'maxPartialMust' || spec.key === 'maxMissingMustForCon') {
        const max = spec.key === 'maxPartialMust' ? GUARD.maxPartialMustMax : GUARD.maxMissingMustMax;
        v = Math.round(v);
        if (v < 0 || v > max) return reject(`项数只能在 0–${max} 之间`);
        if (Math.abs(v - cur) > 1) { notes.push('档位规则一次只能收紧或放宽一级，已调整。'); v = cur + Math.sign(v - cur); }
      } else {
        if (v < 0 || v > 1) return reject('加分项比例必须在 0–1 之间');
        if (Math.abs(v - cur) > GUARD.bonusStep + 1e-9) { notes.push('档位规则一次只能收紧或放宽一级，已调整。'); v = round2(cur + Math.sign(v - cur) * GUARD.bonusStep); }
      }
      if (v === cur) return reject('和当前规则相同');
      if (g.prevParams && reversed(g.prevParams.tierRules[spec.key], cur, v)) return reject('上一轮刚把这条档位规则往相反方向调过，来回调整需要更强的证据，这次先不调');
      spec = { type: 'set_tier_rule', key: spec.key, value: v };
      break;
    }
    case 'remove_city': {
      const c = g.profile.prefs.cities;
      if (!c.preferred.includes(spec.city) && !c.acceptable.includes(spec.city)) return reject(`"${spec.city}"不在你的意向城市里`);
      break;
    }
    case 'promote_direction': {
      if (!dirs.extended.includes(spec.direction)) return reject(`"${spec.direction}"不是 AI 推测的延伸方向`);
      break;
    }
    case 'exclude_direction': {
      if (!(DIRECTIONS as readonly string[]).includes(spec.direction)) return reject('方向名称不在方向清单里');
      if (![...dirs.preferred, ...dirs.acceptable, ...dirs.extended].includes(spec.direction)) return reject(`"${spec.direction}"本来就不在推荐范围里`);
      const dir = spec.direction;
      if (g.lastAccepted.some(s => s.type === 'promote_direction' && s.direction === dir)) return reject('上一轮刚把这个方向加入"可接受"，不能马上反过来');
      break;
    }
    default:
      return reject('不支持的调整类型');
  }

  const kind = kindOf(spec);
  const strong = g.consistent >= GUARD.strongConsistent && g.samples >= GUARD.minSamplesIfStrong;
  const weak = g.samples < GUARD.minSamples && !strong;
  const basisLabel = kind === 'preference' ? '需要你决定'
    : weak ? '依据不足，仅供参考'
      : g.consistent >= GUARD.minConsistent ? `依据：${g.samples} 个投递 · ${g.consistent} 封拒信说法一致`
        : `依据：${g.samples} 个投递`;
  if (kind === 'preference') notes.push('这是你的个人偏好，Agent 只提建议，不会自动修改。');
  return { verdict: 'ok', spec, kind, notes, basisLabel, weak };
}

/** 调整的一句话描述（策略页、复盘页用） */
export function describeChange(s: ChangeSpec, p: StrategyParams): string {
  switch (s.type) {
    case 'add_downgrade': return `新增规则：岗位必须项含 ${s.keyword} 且你不具备 → 不推荐`;
    case 'set_explore_ratio': return `探索比例 ${pct(p.exploreRatio)} → ${pct(s.value)}`;
    case 'set_tier_rule': return s.key === 'maxPartialMust'
      ? `"推荐"档允许的"部分满足"必须项：${p.tierRules.maxPartialMust} → ${s.value} 项`
      : s.key === 'maxMissingMustForCon'
        ? `必须项不满足时：最多允许 ${p.tierRules.maxMissingMustForCon} 项 → ${s.value} 项（超过则不推荐）`
        : `"推荐"档要求的加分项满足比例：${pct(p.tierRules.minBonusRatio)} → ${pct(s.value)}`;
    case 'remove_city': return `把 ${s.city} 移出意向城市`;
    case 'promote_direction': return `把延伸方向"${s.direction}"加入可接受方向`;
    case 'exclude_direction': return `不再推荐"${s.direction}"方向`;
  }
}

/** 执行已采纳的调整：规则 / 比例改策略，偏好改画像 */
export function applyChanges(params: StrategyParams, profile: ProfileData, specs: ChangeSpec[], roundNo: number) {
  const np: StrategyParams = structuredClone(params);
  const pf: ProfileData = structuredClone(profile);
  for (const s of specs) {
    switch (s.type) {
      case 'add_downgrade': np.downgradeRules.push({ keyword: s.keyword, fromRound: roundNo }); break;
      case 'set_explore_ratio': np.exploreRatio = s.value; break;
      case 'set_tier_rule': np.tierRules[s.key] = s.value; break;
      case 'remove_city': {
        const c = pf.prefs.cities;
        c.preferred = c.preferred.filter(x => x !== s.city); c.acceptable = c.acceptable.filter(x => x !== s.city);
        if (!c.excluded.includes(s.city)) c.excluded.push(s.city);
        break;
      }
      case 'promote_direction': {
        const d = pf.prefs.directions;
        d.extended = d.extended.filter(x => x !== s.direction);
        if (!d.acceptable.includes(s.direction)) d.acceptable.push(s.direction);
        break;
      }
      case 'exclude_direction': {
        const d = pf.prefs.directions;
        d.preferred = d.preferred.filter(x => x !== s.direction); d.acceptable = d.acceptable.filter(x => x !== s.direction);
        d.extended = d.extended.filter(x => x !== s.direction);
        if (!d.excluded.includes(s.direction)) d.excluded.push(s.direction);
        break;
      }
    }
  }
  return { params: np, profile: pf, profileChanged: specs.some(s => kindOf(s) === 'preference'), paramsChanged: specs.some(s => kindOf(s) !== 'preference') };
}
