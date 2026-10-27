import 'server-only';
import { z } from 'zod';
import { callJson, MODELS } from '../client';

// 任务：把岗位描述拆成"必须项 / 加分项"。同一岗位同一提示词版本只解析一次（缓存在 job_parses）
export const PROMPT_VERSION = 'parse-job@1';

export const jobReqSchema = z.object({
  must: z.array(z.string()).min(1),
  bonus: z.array(z.string()),
});
export type JobRequirements = z.infer<typeof jobReqSchema>;

export async function parseJob(jdText: string, visitorId: string | null) {
  return callJson({
    task: 'parse-job', promptVersion: PROMPT_VERSION, model: MODELS.fast(), visitorId, schema: jobReqSchema, maxTokens: 1024,
    system: `你负责把校园招聘岗位描述（JD）中的"任职要求"拆成两类：
- must：必须满足的能力或经验要求；
- bonus：写着"优先""加分""者优先"或明显是加分的要求。
规则：
1. 每条要求简短、可以逐条判断，如"熟悉 Java 或 Go""有 Redis 使用经验"；一条只写一个要求。
2. 不要包含届别、学历、到岗天数、实习时长、城市这类条件（程序会单独处理）。
3. 不要包含"岗位职责"里的工作内容，也不要包含"责任心强"这类无法判断的空话。
4. 只输出 JSON：{"must":[],"bonus":[]}`,
    user: jdText,
  });
}
