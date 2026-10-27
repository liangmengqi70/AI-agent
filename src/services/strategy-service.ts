import 'server-only';
// 策略页：当前生效的参数（标注来源）和版本历史
import { listStrategies, type StrategyRow } from '@/db/repos/strategies';
import { getProfileRow, latestConfirmedVersion } from '@/db/repos/profiles';
import { currentRound, listRounds } from '@/db/repos/rounds';
import type { StrategyParams } from '@/domain/config';

type Source = { label: string; kind: 'user' | 'default' | 'review' };

/** 某个参数从哪个版本开始是现在的值：v1 → 默认；之后 → 来自第 N 轮复盘 */
function sourceOf(versions: StrategyRow[], pick: (p: StrategyParams) => unknown): Source {
  const asc = [...versions].sort((a, b) => a.version - b.version);
  const now = JSON.stringify(pick(asc[asc.length - 1].params));
  let since = asc[asc.length - 1];
  for (let i = asc.length - 1; i >= 0 && JSON.stringify(pick(asc[i].params)) === now; i--) since = asc[i];
  return since.version === 1 || !since.source_round_no ? { label: '默认', kind: 'default' } : { label: `第 ${since.source_round_no} 轮复盘`, kind: 'review' };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const TYPE_CN = { intern: '实习', campus: '校招', both: '实习和校招' } as const;

export async function strategyView(visitorId: string) {
  const versions = await listStrategies(visitorId);
  if (!versions.length) return null;
  const cur = versions[0];
  const p = cur.params;
  const profile = (await getProfileRow(visitorId, await latestConfirmedVersion(visitorId)))!.data;
  const round = await currentRound(visitorId);
  const firstSim = (await listRounds(visitorId))[0]?.started_sim ?? null; // v1 的日期 = 第 1 轮开始的模拟日期
  const span = (x: { usual: number | null; max: number | null }) => x.usual === x.max ? `${x.usual ?? '—'}` : `${x.usual ?? '—'}–${x.max ?? '—'}`;
  const you: Source = { label: '你设置', kind: 'user' };
  const pr = profile.prefs;

  const params = [
    { k: '求职类型', v: `${TYPE_CN[pr.jobType ?? 'intern']}${pr.jobType !== 'campus' && pr.internKinds.length ? `（${pr.internKinds.map(x => x === 'daily' ? '日常' : '暑期').join(' + ')}）` : ''}`, src: you },
    { k: '目标方向', v: `首选 ${pr.directions.preferred.join('、') || '—'}；可接受 ${pr.directions.acceptable.join('、') || '—'}${pr.directions.extended.length ? `；延伸（AI 推测）${pr.directions.extended.join('、')}` : ''}${pr.directions.excluded.length ? `；不考虑 ${pr.directions.excluded.join('、')}` : ''}`, src: you },
    { k: '意向城市', v: pr.cities.anyCity ? '不限' : `首选 ${pr.cities.preferred.join('、') || '—'}；可接受 ${pr.cities.acceptable.join('、') || '—'}`, src: you },
    ...(pr.jobType !== 'campus' ? [{ k: '到岗 / 时长', v: `每周通常 ${pr.daysPerWeek.usual ?? '—'} 天，最多 ${pr.daysPerWeek.max ?? '—'} 天；${span(pr.months)} 个月`, src: you }] : []),
    { k: '"推荐"档规则', v: `必须项全部满足（最多 ${p.tierRules.maxPartialMust} 项部分满足），加分项满足 ${pct(p.tierRules.minBonusRatio)} 以上`, src: sourceOf(versions, x => x.tierRules) },
    ...p.downgradeRules.map(r => ({ k: '新增规则', v: `岗位必须项含 ${r.keyword} 且你不具备 → 不推荐`, src: { label: `第 ${r.fromRound ?? '?'} 轮复盘`, kind: 'review' as const } })),
    { k: '探索比例', v: `${pct(p.exploreRatio)}（下限 ${pct(p.exploreRatioMin)}）`, src: sourceOf(versions, x => x.exploreRatio) },
    { k: '投递限制', v: `每轮最多 ${p.roundApplyLimit} 个；同公司每季最多 ${p.sameCompanyLimit} 个`, src: sourceOf(versions, x => [x.roundApplyLimit, x.sameCompanyLimit]) },
  ];

  return {
    version: cur.version,
    usedBy: round && round.strategy_version === cur.version ? `第 ${round.round_no} 轮正在使用` : round ? `将用于第 ${round.round_no + 1} 轮` : '',
    params,
    history: versions.map(v => ({
      version: v.version, date: v.version === 1 ? firstSim : v.source_sim, roundNo: v.source_round_no,
      title: v.version === 1 ? '来自你确认的画像与偏好' : `来自第 ${v.source_round_no} 轮复盘`,
      changes: v.version === 1 ? [{ text: '根据偏好生成硬过滤条件；档位规则和探索比例使用默认值', accepted: true, kind: 'default' }] : v.changes ?? [],
    })),
  };
}
