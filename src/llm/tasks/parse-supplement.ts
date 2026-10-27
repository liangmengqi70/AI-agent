import 'server-only';
import { z } from 'zod';
import { callJson, MODELS } from '../client';
import { experienceSchema, type ProfileData } from '@/domain/profile';
import type { SupplementChanges } from '@/domain/profile-merge';

// 任务：只解析用户补充的自由文本，输出需要"新增"的内容（不修改已有字段）
export const PROMPT_VERSION = 'parse-supplement@2';

const schema = z.object({
  addSkills: z.array(z.string()),
  addExperiences: z.array(experienceSchema),
  avoid: z.array(z.string()),
  lines: z.array(z.string()),
});

export async function parseSupplement(text: string, current: ProfileData, visitorId: string): Promise<SupplementChanges> {
  return callJson({
    task: 'parse-supplement', promptVersion: PROMPT_VERSION, model: MODELS.fast(), visitorId, schema, maxTokens: 2048,
    system: `你负责把学生补充的一段话整理成结构化的"新增信息"。规则：
1. 只根据补充文字提取，不编造；已有的技能不要重复列出。
2. addSkills：新提到的技能；如果提到熟练程度，在技能名后用括号注明，如"Spark（入门）"。
3. addExperiences：补充的实习或项目经历；没有就给空数组。
4. avoid：明确表示不想去的公司类型或行业，如"外包公司"。
5. lines：给用户看的确认说明，每条一句，如"新增技能：Spark（入门）""新增偏好：不考虑外包公司"。
6. 只输出 JSON。`,
    user: `已有技能：${current.skills.join('、') || '无'}
补充文字：
"""
${text}
"""
输出格式（addExperiences 的每一项必须是对象，不能是字符串）：
{
  "addSkills": ["Spark（入门）"],
  "addExperiences": [{ "kind": "internship | project", "title": "名称", "role": "角色", "period": "时间，没有写空字符串", "detail": "做了什么", "tech": ["技术"] }],
  "avoid": ["外包公司"],
  "lines": ["新增技能：Spark（入门）"]
}`,
  });
}
