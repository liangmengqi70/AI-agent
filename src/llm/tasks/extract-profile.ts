import 'server-only';
import { z } from 'zod';
import { callJson, MODELS } from '../client';
import { DEGREES, DIRECTIONS, CITIES, experienceSchema } from '@/domain/profile';

// 任务：读简历 → 结构化画像 + 推测求职意向（每项附依据）
export const PROMPT_VERSION = 'extract-profile@2';

const inferred = <T extends z.ZodTypeAny>(value: T) => z.object({ value, reason: z.string() }).nullable();

export const extractSchema = z.object({
  basics: z.object({
    school: z.string().nullable(),
    degree: z.enum(DEGREES).nullable(),
    major: z.string().nullable(),
    gradYear: z.number().int().nullable(),
  }),
  skills: z.array(z.string()),
  courses: z.array(z.string()).default([]),
  experiences: z.array(experienceSchema),
  awards: z.array(z.string()),
  inferred: z.object({
    jobType: inferred(z.enum(['intern', 'campus', 'both'])),
    directions: inferred(z.object({ preferred: z.array(z.string()), acceptable: z.array(z.string()) })),
    cities: inferred(z.array(z.string())),
    // 只推测出"通常"时长、没给"最多"时，按"通常"处理（之前这种情况会导致整份简历解析失败）
    months: inferred(z.object({ usual: z.number(), max: z.number().nullable() }).transform(v => ({ usual: v.usual, max: v.max ?? v.usual }))),
  }),
});
export type ExtractResult = z.infer<typeof extractSchema>;

const SYSTEM = `你是一名校园招聘方向的简历信息整理助手。你的任务是从学生简历中准确提取信息，并谨慎推测求职意向。
规则：
1. 只提取简历中明确写出的信息，不编造、不美化；简历没写的字段填 null 或空数组。
2. skills 只列具体技能或工具名（如 Java、MySQL、Figma），每项尽量简短，最多 15 项。
3. courses：简历中写到的主修课程或核心课程，原样列出，没有就给空数组。
4. experiences：实习写 kind="internship"，项目 / 课程项目 / 竞赛项目写 kind="project"；detail 用 1–2 句话概括本人做了什么，tech 列出用到的技术。
5. gradYear 是毕业年份（届别），可根据入学年份 + 学制推算，例如 2023 级本科 → 2027。
6. inferred 是推测的求职意向，必须在 reason 中写出依据（引用简历中的事实），没有依据就填 null：
   - jobType：intern=找实习，campus=找校招全职，both=都看。距毕业超过 1 年通常是 intern。
   - directions.preferred / acceptable 只能从这些方向中选：${DIRECTIONS.join('、')}。
   - cities 只在简历中有明确线索（如学校所在地、实习城市）时推测，从这些城市中选：${CITIES.join('、')}。
   - months 是可实习时长（月），usual ≤ max。
7. 只输出 JSON，不要任何解释文字。`;

export async function extractProfile(resumeText: string, visitorId: string) {
  return callJson({
    task: 'extract-profile', promptVersion: PROMPT_VERSION, model: MODELS.fast(), visitorId,
    schema: extractSchema, maxTokens: 4096,
    system: SYSTEM,
    user: `请从下面的简历中提取信息，按这个 JSON 结构输出：
{
  "basics": { "school": "学校", "degree": "${DEGREES.join(' | ')} 或 null", "major": "专业", "gradYear": 2027 },
  "skills": ["技能"],
  "courses": ["主修课程"],
  "experiences": [{ "kind": "internship | project", "title": "名称", "role": "角色", "period": "时间段", "detail": "做了什么", "tech": ["技术"] }],
  "awards": ["竞赛 / 证书 / 奖项"],
  "inferred": {
    "jobType": { "value": "intern | campus | both", "reason": "依据" } 或 null,
    "directions": { "value": { "preferred": ["方向"], "acceptable": ["方向"] }, "reason": "依据" } 或 null,
    "cities": { "value": ["城市"], "reason": "依据" } 或 null,
    "months": { "value": { "usual": 3, "max": 6 }, "reason": "依据" } 或 null
  }
}

简历内容：
"""
${resumeText}
"""`,
  });
}
