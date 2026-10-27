import 'server-only';
import { z } from 'zod';
import { callJson, MODELS } from '../client';
import type { ProfileData } from '@/domain/profile';
import type { JobRequirements } from './parse-job';

// 任务：逐条判断岗位要求是否满足，并引用画像中的依据。不输出档位或分数（档位由程序判定）。
export const PROMPT_VERSION = 'match-job@2';

const schema = z.object({
  judgments: z.array(z.object({
    req: z.string(),
    kind: z.enum(['must', 'bonus']),
    status: z.enum(['ok', 'part', 'no']),
    evidence: z.string(),
  })),
  summary: z.string(),
  risk: z.string().nullable(),
});
export type MatchResult = z.infer<typeof schema>;

/** 把画像整理成给大模型看的文字（不含求职偏好，避免影响判断） */
export function profileForMatching(p: ProfileData) {
  const b = p.basics;
  return [
    `学历：${b.school ?? ''} · ${b.degree ?? ''} · ${b.major ?? ''} · ${b.gradYear ?? ''} 届`,
    `技能：${p.skills.join('、') || '无'}`,
    p.courses.length ? `主修课程：${p.courses.join('、')}` : '',
    ...p.experiences.map(e => `${e.kind === 'internship' ? '实习' : '项目'}：${e.title}（${e.role}，${e.period}）${e.detail}${e.tech.length ? ` 技术：${e.tech.join('、')}` : ''}`),
    p.awards.length ? `竞赛 / 证书：${p.awards.join('、')}` : '',
  ].filter(Boolean).join('\n');
}

export async function matchJob(profileText: string, title: string, req: JobRequirements, visitorId: string) {
  const list = [...req.must.map(r => ({ req: r, kind: 'must' })), ...req.bonus.map(r => ({ req: r, kind: 'bonus' }))];
  return callJson({
    task: 'match-job', promptVersion: PROMPT_VERSION, model: MODELS.fast(), visitorId, schema, maxTokens: 2048,
    system: `你是严谨的校园招聘筛选助手。请逐条判断候选人是否满足岗位要求。
判断标准：
- ok：画像中有明确证据（技能、项目、实习、竞赛）；
- part：有相关但不充分的证据，例如只在课程或自学中接触过、项目规模很小、技能相近但不同；
- no：画像中找不到任何相关证据。
基础知识类要求（如数据结构与算法、计算机网络、操作系统、数据库原理、统计学、市场营销学）：主修课程中有相关课程 → 至少 part；有项目或竞赛实际应用 → ok；专业对口但没写课程 → part。
规则：
1. evidence 必须引用画像中的具体内容（如项目名、技能名），不能编造；判为 no 时写"简历中没有相关内容"。
2. 按给定的要求清单逐条输出，req 和 kind 原样保留，不增不减。
3. summary：一两句话概括匹配情况（不要写"推荐""不推荐"或分数）。
4. risk：投递这个岗位最需要注意的一点，没有就写 null。
5. 只输出 JSON：{"judgments":[{"req":"","kind":"must","status":"ok","evidence":""}],"summary":"","risk":null}`,
    user: `岗位：${title}
要求清单：${JSON.stringify(list)}

候选人画像：
${profileText}`,
  });
}
