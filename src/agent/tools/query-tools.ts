import 'server-only';
// 复盘的只读工具：统计、分组、拒信、跳过原因、投递详情、岗位对比、样本量、策略历史
import { computeStats, groupLabel, stageOf, STAGE_CN, type ReviewStats } from '@/domain/review';
import { GUARD } from '@/domain/guardrails';
import { FILTER_SCHEMA, filterApps, filterText, type AppFilter, type Tool } from './types';

const DIM_CN: Record<string, string> = { tier: '推荐档位', direction: '方向', city: '城市', companyType: '公司类型', jobType: '岗位类型' };

export const getRoundStats: Tool = {
  name: 'get_round_stats',
  description: '本轮整体结果：投递数、已回复数（通过或被拒都算）、等待回复数、各环节通过数。先调用这个了解全貌。',
  parameters: { type: 'object', properties: {} },
  plain: () => '看整体结果',
  run: (_a, { data }) => {
    const s = computeStats(data.apps);
    return {
      投递: s.applied, 已回复: s.withResult, 等待回复: s.pending, 无回应: s.noResponse,
      简历通过: s.resumePass, 简历未通过: s.resumeReject, 收到笔试: s.examInvited, 笔试通过: s.examPass, 笔试结果待出: s.examPending,
      进入面试: s.interview, Offer: s.offer, 说明: data.carriedIds.length ? `其中 ${data.carriedIds.length} 个是上一轮复盘时还在等待、现在有了回复的投递` : undefined,
      备注: '"等待回复"不算失败；比较通过率时应排除等待回复的投递。',
    };
  },
};

export const queryOutcomes: Tool<{ groupBy: keyof ReviewStats['groups']; filter?: AppFilter }> = {
  name: 'query_outcomes',
  description: '按一个维度分组统计：每组投递数、简历通过数、简历被拒数、等待回复数、进入面试数。可以先用 filter 缩小范围。',
  parameters: {
    type: 'object', required: ['groupBy'],
    properties: { groupBy: { type: 'string', enum: ['tier', 'direction', 'city', 'companyType', 'jobType'] }, filter: FILTER_SCHEMA },
  },
  plain: a => `按${DIM_CN[a.groupBy] ?? a.groupBy}对比${a.filter && Object.keys(a.filter).length ? `（${filterText(a.filter)}）` : ''}`,
  run: (a, { data }) => {
    const rows = computeStats(filterApps(data.apps, a.filter)).groups[a.groupBy] ?? [];
    return rows.map(r => ({ 分组: r.key, 投递: r.n, 简历通过: r.resumePass, 简历被拒: r.resumeReject, 等待回复: r.pending, 进入面试: r.interview, 样本是否足够: r.n >= GUARD.minSamples }));
  },
};

export const getRejectionMessages: Tool<{ filter?: AppFilter }> = {
  name: 'get_rejection_messages',
  description: '查询被拒投递的拒信原文（有些公司拒信不写原因）。可按方向、档位、城市等筛选。',
  parameters: { type: 'object', properties: { filter: FILTER_SCHEMA } },
  plain: a => `阅读${filterText(a.filter) === '全部' ? '' : filterText(a.filter)}的拒信`,
  run: (a, { data }) => {
    const rejected = filterApps(data.apps, a.filter).filter(x => x.events.some(e => e.type === 'rejected'));
    return {
      被拒总数: rejected.length,
      拒信: rejected.map(x => ({
        投递编号: x.id, 公司: x.company, 岗位: x.title, 方向: x.direction, 档位: groupLabel('tier', x.tier), 阶段: STAGE_CN[stageOf(x)],
        拒信: x.events.find(e => e.type === 'rejected')?.message ?? '（没有写原因）',
      })),
    };
  },
};

export const getSkipReasons: Tool = {
  name: 'get_skip_reasons',
  description: '用户在推荐页跳过岗位时给出的原因（快捷原因 + 自由文字）。用于发现用户没说出口的偏好。',
  parameters: { type: 'object', properties: {} },
  plain: () => '查看你跳过岗位的原因',
  run: (_a, { data }) => ({
    跳过总数: data.skips.length,
    跳过: data.skips.map(s => ({ 岗位: s.title, 公司: s.company, 城市: s.city, 方向: s.direction, 档位: s.tier, 是否延伸方向: s.extended, 快捷原因: s.quick, 说明: s.note ?? '（没有说明）' })),
  }),
};

export const getApplicationDetail: Tool<{ appId: string }> = {
  name: 'get_application_detail',
  description: '单个投递的详情：岗位信息、推荐时对每条要求的判断（满足 / 部分满足 / 不满足）、结果时间线。',
  parameters: { type: 'object', required: ['appId'], properties: { appId: { type: 'string', description: '投递编号' } } },
  plain: (a, { data }) => { const x = data.apps.find(y => y.id === String(a.appId)); return x ? `查看「${x.company} · ${x.title}」的投递详情` : '查看一个投递的详情'; },
  run: (a, { data }) => {
    const x = data.apps.find(y => y.id === String(a.appId));
    if (!x) return { 错误: '找不到这个投递编号' };
    return {
      岗位: x.title, 公司: x.company, 城市: x.city, 方向: x.direction, 档位: groupLabel('tier', x.tier), 延伸方向: data.extendedJobIds.has(x.jobId),
      推荐时的逐条判断: (data.judgments.get(x.id) ?? []).map(j => ({ 要求: j.req, 类型: j.kind === 'must' ? '必须项' : '加分项', 判断: { ok: '满足', part: '部分满足', no: '不满足' }[j.status] })),
      结果: x.events.map(e => `${e.simDate} ${e.type}${e.message ? `：${e.message}` : ''}`),
    };
  },
};

export const compareJobs: Tool<{ groupA: AppFilter; groupB: AppFilter }> = {
  name: 'compare_jobs',
  description: '对比两组投递（例如简历通过的 vs 简历被拒的）在岗位要求上的差异：列出每个岗位中用户"不满足"或"部分满足"的要求。',
  parameters: { type: 'object', required: ['groupA', 'groupB'], properties: { groupA: FILTER_SCHEMA, groupB: FILTER_SCHEMA } },
  plain: a => `对比两组岗位的要求（${filterText(a.groupA)} vs ${filterText(a.groupB)}）`,
  run: (a, { data }) => {
    const side = (f: AppFilter) => filterApps(data.apps, f).slice(0, 15).map(x => {
      const js = data.judgments.get(x.id) ?? [];
      return {
        投递编号: x.id, 岗位: `${x.company} · ${x.title}`, 阶段: STAGE_CN[stageOf(x)],
        不满足: js.filter(j => j.status === 'no').map(j => `${j.req}（${j.kind === 'must' ? '必须' : '加分'}）`),
        部分满足: js.filter(j => j.status === 'part').map(j => `${j.req}（${j.kind === 'must' ? '必须' : '加分'}）`),
      };
    });
    return { A组: side(a.groupA), B组: side(a.groupB) };
  },
};

export const checkSampleSize: Tool<{ appIds: string[] }> = {
  name: 'check_sample_size',
  description: `检查某个结论引用的投递是否足够（至少 ${GUARD.minSamples} 个才算证据充足）。`,
  parameters: { type: 'object', required: ['appIds'], properties: { appIds: { type: 'array', items: { type: 'string' } } } },
  plain: a => `检查证据够不够（${a.appIds?.length ?? 0} 个投递）`,
  run: (a, { data }) => {
    const valid = (a.appIds ?? []).map(String).filter(id => data.apps.some(x => x.id === id));
    const resolved = valid.filter(id => stageOf(data.apps.find(x => x.id === id)!) !== 'pending');
    return { 有效投递: valid.length, 其中已回复: resolved.length, 最少需要: GUARD.minSamples, 是否足够: resolved.length >= GUARD.minSamples };
  },
};

export const getStrategyHistory: Tool = {
  name: 'get_strategy_history',
  description: '之前的策略版本、每次调整的内容（采纳和未采纳的建议），用于避免来回调整。',
  parameters: { type: 'object', properties: {} },
  plain: () => '回顾之前的策略调整',
  run: (_a, { data }) => ({
    当前参数: {
      探索比例: data.params.exploreRatio, 探索比例下限: data.params.exploreRatioMin,
      推荐档规则: { 最多部分满足的必须项: data.params.tierRules.maxPartialMust, 加分项最低满足比例: data.params.tierRules.minBonusRatio },
      降为不推荐的关键词: data.params.downgradeRules.map(r => r.keyword),
    },
    用户偏好: { 方向: data.profile.prefs.directions, 城市: { 首选: data.profile.prefs.cities.preferred, 可接受: data.profile.prefs.cities.acceptable } },
    历史版本: data.strategies.map(s => ({ 版本: s.version, 来源: s.source_round_no ? `第 ${s.source_round_no} 轮复盘` : '初始', 变化: s.changes ?? [] })),
  }),
};
