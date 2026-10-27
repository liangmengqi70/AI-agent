import 'server-only';
// 唯一的写入工具：提交调整建议。只写入"待你确认"的建议区，护栏检查不通过会退回给大模型（最多 2 次）。
import { checkProposal, type ChangeSpec } from '@/domain/guardrails';
import { DIRECTIONS } from '@/domain/profile';
import { stageOf, type ReviewApp } from '@/domain/review';
import { addProposal } from '@/db/repos/reviews';
import type { Tool } from './types';

const TIER_KEYS = ['maxPartialMust', 'minBonusRatio', 'maxMissingMustForCon'] as const;

type Args = {
  title: string;
  change: { type: string; keyword?: string; value?: number; key?: string; city?: string; direction?: string };
  evidence: string[];
  cautions?: string[];
  tip?: string;
  appIds: string[];
};

export const MAX_GUARD_RETRIES = 2;

function toSpec(c: Args['change']): ChangeSpec | string {
  switch (c.type) {
    case 'add_downgrade': return c.keyword ? { type: 'add_downgrade', keyword: c.keyword } : '缺少 keyword';
    case 'set_explore_ratio': return typeof c.value === 'number' ? { type: 'set_explore_ratio', value: c.value } : '缺少 value';
    case 'set_tier_rule': {
      const key = TIER_KEYS.find(k => k === c.key);
      return key && typeof c.value === 'number' ? { type: 'set_tier_rule', key, value: c.value } : 'key 或 value 不正确';
    }
    case 'remove_city': return c.city ? { type: 'remove_city', city: c.city } : '缺少 city';
    case 'promote_direction': return c.direction ? { type: 'promote_direction', direction: c.direction } : '缺少 direction';
    case 'exclude_direction': return c.direction ? { type: 'exclude_direction', direction: c.direction } : '缺少 direction';
    default: return '不支持的调整类型';
  }
}

export const proposeChange: Tool<Args> = {
  name: 'propose_change',
  description: [
    '提交一条策略调整建议（会经过程序护栏检查，最终由用户决定是否采纳）。可用的调整类型：',
    '- add_downgrade{keyword}：岗位必须项含该关键词且用户不具备时降为"不推荐"（如 Spark）',
    '- set_explore_ratio{value}：探索岗位比例（0–1，单轮最多调 0.1，下限 0.1）',
    '- set_tier_rule{key, value}：档位标准，一次只能调一级。maxPartialMust="推荐"档最多允许几项必须项部分满足；minBonusRatio="推荐"档加分项最低满足比例；maxMissingMustForCon=必须项不满足几项以内还能放进"可以考虑"（改为 0 表示有不满足的必须项就不推荐）',
    '- remove_city{city}：建议把某城市移出意向城市（偏好，只能建议）',
    '- promote_direction{direction}：建议把表现好的延伸方向加入"可接受"（偏好，只能建议）',
    '- exclude_direction{direction}：建议不再推荐某方向（偏好，只能建议）',
    'evidence 写 2–4 条具体证据（引用数字，关键数字用 **加粗**）；appIds 填支撑证据的投递编号。',
  ].join('\n'),
  parameters: {
    type: 'object', required: ['title', 'change', 'evidence', 'appIds'],
    properties: {
      title: { type: 'string', description: '一句话说明要调整什么，如"不再推荐要求 Spark / Hive 的岗位"' },
      change: {
        type: 'object', required: ['type'],
        properties: {
          type: { type: 'string', enum: ['add_downgrade', 'set_explore_ratio', 'set_tier_rule', 'remove_city', 'promote_direction', 'exclude_direction'] },
          keyword: { type: 'string' }, value: { type: 'number' }, key: { type: 'string', enum: [...TIER_KEYS] },
          city: { type: 'string' }, direction: { type: 'string', enum: [...DIRECTIONS] },
        },
      },
      evidence: { type: 'array', items: { type: 'string' } },
      cautions: { type: 'array', items: { type: 'string' }, description: '需要注意的地方（可选）' },
      tip: { type: 'string', description: '给用户的一句行动建议（可选），如"可以先补一个 Spark 小项目"' },
      appIds: { type: 'array', items: { type: 'string' } },
    },
  },
  plain: a => `提出建议：${a.title}`,
  run: async (a, ctx) => {
    const { data } = ctx;
    const spec = toSpec(a.change ?? { type: '' });
    const typeKey = a.change?.type ?? '';
    const retry = (reason: string) => {
      const n = (ctx.rejections.get(typeKey) ?? 0) + 1;
      ctx.rejections.set(typeKey, n);
      return n > MAX_GUARD_RETRIES
        ? { 结果: '已丢弃', 原因: reason, 说明: '这类建议已被退回多次，不再接受' }
        : { 结果: '被护栏退回', 原因: reason, 可以再试: MAX_GUARD_RETRIES - n + 1 };
    };
    if ((ctx.rejections.get(typeKey) ?? 0) > MAX_GUARD_RETRIES) return { 结果: '已丢弃', 说明: '这类建议已被退回多次，不再接受' };
    if (typeof spec === 'string') return retry(spec);

    // 证据由程序核实，不由大模型自己说：只认本次复盘范围内、已有结果的投递
    const resolved = (x: ReviewApp) => stageOf(x) !== 'pending';
    const cited = data.apps.filter(x => (a.appIds ?? []).map(String).includes(x.id) && resolved(x));
    let samples = cited.length, consistent = 0;
    if (spec.type === 'add_downgrade') {
      // 关键词规则：程序自己找出"必须项含该关键词且你不满足"的投递，并数提到该关键词的拒信
      const kw = spec.keyword.toLowerCase();
      const affected = data.apps.filter(x => resolved(x) && (data.judgments.get(x.id) ?? []).some(j => j.kind === 'must' && j.status !== 'ok' && j.req.toLowerCase().includes(kw)));
      samples = new Set([...cited, ...affected].map(x => x.id)).size;
      consistent = data.apps.filter(x => x.events.some(e => e.type === 'rejected' && e.message?.toLowerCase().includes(kw))).length;
    }
    const g = checkProposal({ spec, params: data.params, profile: data.profile, prevParams: data.prevParams, lastAccepted: data.lastAccepted, samples, consistent });
    if (g.verdict === 'reject') return retry(g.reason);

    const seq = await addProposal(ctx.reviewId, {
      kind: g.kind, title: a.title,
      evidence: { bullets: (a.evidence ?? []).slice(0, 5), cautions: (a.cautions ?? []).slice(0, 3), tip: a.tip ?? null, appIds: cited.map(x => x.id) },
      basis_label: g.basisLabel, change_spec: g.spec, guard_result: { notes: g.notes, weak: g.weak, original: spec },
    });
    return { 结果: '已提交', 建议编号: seq, 依据说明: g.basisLabel, 护栏说明: g.notes };
  },
};
