import 'server-only';
import { z } from 'zod';
import { callJson, MODELS } from '../client';

// 复盘总结：根据调查过程和已提交的建议，整理"本轮发现"列表（问题 / 偏好 / 正常）
export const REVIEW_SUMMARY_VERSION = 'review-summary@2';

const schema = z.object({
  findings: z.array(z.object({
    type: z.enum(['problem', 'preference', 'normal']),
    title: z.string().min(2).max(60),
    detail: z.string().min(2).max(200),
    proposals: z.array(z.number().int()).default([]),
  })).max(8),
});
export type ReviewSummary = z.infer<typeof schema>;

const SYSTEM = `你是求职策略复盘助手，负责把调查结果整理成"本轮发现"，给大学生 / 应届生看。
要求：
- 每条发现分类：problem（结果不理想的问题）、preference（用户可能没说出口的偏好）、normal（表现正常，保持不变）；
- 按重要程度排序，最重要的在前；条数按实际情况，通常 2–5 条；
- title 一句话结论（不超过 20 字），detail 用一两句话写清依据，必须引用调查中出现过的具体数字，不能编造；
- proposals 填这条发现对应的建议编号（来自"已提交的建议"），没有对应建议的填 []；
- "等待回复"的投递不算失败；"已回复"包括通过和被拒，描述时说清是"简历通过"还是"简历被拒"，不要用"有结果"这种说法；样本很少时要说明"样本较少"；
- 语言平实，不用术语，不出现工具名、函数名、投递编号；提到具体岗位时写公司名和岗位名。
只输出 JSON：{"findings":[{"type":"problem","title":"...","detail":"...","proposals":[1]}]}`;

export async function summarizeReview(input: { stats: unknown; investigation: string; proposals: Array<{ seq: number; title: string; basis: string }>; conclusion: string }, visitorId: string) {
  const user = [
    `本轮统计：${JSON.stringify(input.stats)}`,
    `调查过程：\n${input.investigation}`,
    `已提交的建议：${input.proposals.length ? input.proposals.map(p => `${p.seq}. ${p.title}（${p.basis}）`).join('；') : '无'}`,
    `调查结论：${input.conclusion || '（无）'}`,
  ].join('\n\n');
  return callJson({ task: 'review-summary', promptVersion: REVIEW_SUMMARY_VERSION, model: MODELS.reason(), system: SYSTEM, user, schema, visitorId, maxTokens: 2000 });
}
