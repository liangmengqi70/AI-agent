import 'server-only';
import { z } from 'zod';
import { callJson, MODELS } from '../client';
import { DIRECTIONS, type ProfileData } from '@/domain/profile';

// 任务：根据技能和经历，推测用户没选、但可能适合的"延伸方向"（最多 3 个，必须有技能依据）
export const PROMPT_VERSION = 'suggest-directions@1';

const schema = z.object({
  items: z.array(z.object({ direction: z.string(), reason: z.string() })),
});

export async function suggestDirections(d: ProfileData, visitorId: string) {
  const chosen = [...d.prefs.directions.preferred, ...d.prefs.directions.acceptable, ...d.prefs.directions.excluded];
  const candidates = DIRECTIONS.filter(x => x !== '其他' && !chosen.includes(x));
  if (!candidates.length) return [];
  const res = await callJson({
    task: 'suggest-directions', promptVersion: PROMPT_VERSION, model: MODELS.fast(), visitorId, schema, maxTokens: 1024,
    system: `你是校园招聘方向的职业顾问。根据学生的技能和经历，推测他没有选、但很可能适合的岗位方向（"延伸方向"）。
规则：
1. 只能从给定的候选方向中选，最多 3 个；宁缺毋滥，技能对不上就不要推测。
2. 每个方向的 reason 必须写出是哪些具体技能或经历对上了，一句话，不超过 30 字。
3. 只输出 JSON：{"items":[{"direction":"方向","reason":"依据"}]}`,
    user: `已选方向：首选 ${d.prefs.directions.preferred.join('、') || '无'}；可接受 ${d.prefs.directions.acceptable.join('、') || '无'}
专业：${d.basics.major ?? '未知'}
技能：${d.skills.join('、') || '无'}
经历：${d.experiences.map(e => `${e.title}（${e.tech.join('、')}）：${e.detail}`).join('；') || '无'}
候选方向：${candidates.join('、')}`,
  });
  return res.items.filter(i => candidates.includes(i.direction as typeof candidates[number])).slice(0, 3);
}
