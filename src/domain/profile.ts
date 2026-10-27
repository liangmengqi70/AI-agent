// 画像与求职偏好：数据结构、必填清单、完整性检查、保存前校验
// 本文件只放规则（纯函数），不访问数据库，不调用大模型。
import { z } from 'zod';

/* ---------- 可选项 ---------- */
export const DEGREES = ['大专', '本科', '硕士', '博士'] as const;
export const DIRECTIONS = [
  '后端开发', '前端开发', '数据开发', '算法', 'AI 应用开发', '测试开发', '移动开发',
  '产品经理', 'AI 产品经理', '产品运营', '内容运营', '用户运营', '新媒体运营',
  '市场营销', 'UI / UX 设计', '人力资源', '销售', '其他',
] as const;
export const CITIES = ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京', '西安', '苏州'] as const;

/* ---------- 数据结构 ---------- */
export const experienceSchema = z.object({
  kind: z.enum(['internship', 'project']),
  title: z.string(),
  role: z.string().default(''),
  period: z.string().default(''),
  detail: z.string().default(''),
  tech: z.array(z.string()).default([]),
});
export type Experience = z.infer<typeof experienceSchema>;

export const profileDataSchema = z.object({
  basics: z.object({
    school: z.string().nullable(),
    degree: z.enum(DEGREES).nullable(),
    major: z.string().nullable(),
    gradYear: z.number().int().nullable(),
  }),
  skills: z.array(z.string()),
  courses: z.array(z.string()).default([]),   // 主修课程（用于判断基础知识类要求）
  experiences: z.array(experienceSchema),
  awards: z.array(z.string()),
  prefs: z.object({
    jobType: z.enum(['intern', 'campus', 'both']).nullable(),
    internKinds: z.array(z.enum(['daily', 'summer'])),
    directions: z.object({
      preferred: z.array(z.string()),
      acceptable: z.array(z.string()),
      extended: z.array(z.string()).default([]),   // 延伸方向：AI 根据技能推测，用户可删除
      excluded: z.array(z.string()).default([]),   // 不考虑的方向：用户删除过的延伸方向，不再推测
    }),
    cities: z.object({
      preferred: z.array(z.string()),
      acceptable: z.array(z.string()),
      excluded: z.array(z.string()),
      remoteOk: z.boolean(),
      anyCity: z.boolean(),
    }),
    internPayMin: z.number().nullable(),   // 元 / 天；null = 不限（选填）
    campusPayMin: z.number().nullable(),   // 月薪，千元；null = 不限（选填）
    daysPerWeek: z.object({ usual: z.number().nullable(), max: z.number().nullable() }),
    months: z.object({ usual: z.number().nullable(), max: z.number().nullable() }),
    valueConversion: z.boolean(),           // 看重转正机会
    avoid: z.array(z.string()),             // 不想去的公司类型等（来自补充说明）
  }),
});
export type ProfileData = z.infer<typeof profileDataSchema>;

/* ---------- 字段来源 ---------- */
export type FieldSource = 'resume' | 'ai' | 'missing' | 'user' | 'supplement' | 'default';
export type FieldSources = Record<string, { source: FieldSource; reason?: string }>;

export const FIELD_KEYS = [
  'basics.school', 'basics.degree', 'basics.major', 'basics.gradYear',
  'skills', 'courses', 'experiences', 'awards',
  'prefs.jobType', 'prefs.directions', 'prefs.cities',
  'prefs.internPayMin', 'prefs.campusPayMin', 'prefs.daysPerWeek', 'prefs.months', 'prefs.valueConversion',
] as const;
export type FieldKey = typeof FIELD_KEYS[number];

export function emptyProfile(): ProfileData {
  return {
    basics: { school: null, degree: null, major: null, gradYear: null },
    skills: [], courses: [], experiences: [], awards: [],
    prefs: {
      jobType: null, internKinds: ['daily', 'summer'],
      directions: { preferred: [], acceptable: [], extended: [], excluded: [] },
      cities: { preferred: [], acceptable: [], excluded: [], remoteOk: false, anyCity: false },
      internPayMin: null, campusPayMin: null,
      daysPerWeek: { usual: null, max: null },
      months: { usual: null, max: null },
      valueConversion: true, avoid: [],
    },
  };
}

/* ---------- 必填清单 ---------- */
const needsIntern = (d: ProfileData) => d.prefs.jobType === 'intern' || d.prefs.jobType === 'both';
const needsCampus = (d: ProfileData) => d.prefs.jobType === 'campus' || d.prefs.jobType === 'both';

/** 返回该字段当前是否已有值（用于完整性检查和保存前校验） */
export function isFilled(d: ProfileData, key: FieldKey): boolean {
  const p = d.prefs;
  switch (key) {
    case 'basics.school': return !!d.basics.school?.trim();
    case 'basics.degree': return !!d.basics.degree;
    case 'basics.major': return !!d.basics.major?.trim();
    case 'basics.gradYear': return !!d.basics.gradYear;
    case 'skills': return d.skills.length > 0;
    case 'experiences': return d.experiences.length > 0;
    case 'awards': return true; // 选填
    case 'courses': return true; // 选填
    case 'prefs.jobType': return !!p.jobType;
    case 'prefs.directions': return p.directions.preferred.length > 0;
    case 'prefs.cities': return p.cities.preferred.length > 0 || p.cities.anyCity || p.cities.remoteOk;
    case 'prefs.internPayMin': return true; // 选填：不填 = 不限
    case 'prefs.campusPayMin': return true; // 选填：不填 = 不限
    case 'prefs.daysPerWeek': return !needsIntern(d) || (!!p.daysPerWeek.usual && !!p.daysPerWeek.max);
    case 'prefs.months': return !needsIntern(d) || (!!p.months.usual && !!p.months.max);
    case 'prefs.valueConversion': return true;
  }
}

/** 完整性检查：把字段分为 已有 / AI 推测（需确认）/ 缺失 */
export function completeness(d: ProfileData, sources: FieldSources) {
  let filled = 0, toConfirm = 0, missing = 0;
  for (const key of FIELD_KEYS) {
    if (!isFilled(d, key)) { missing++; continue; }
    filled++;
    if (sources[key]?.source === 'ai') toConfirm++;
  }
  return { filled, toConfirm, missing };
}

/** 保存前校验：返回 字段 → 错误提示；没有错误则返回空对象 */
export function validateProfile(d: ProfileData): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {};
  for (const key of FIELD_KEYS) if (!isFilled(d, key)) errors[key] = '必填：请补充这一项';
  const p = d.prefs;
  if (needsIntern(d)) {
    const { usual, max } = p.daysPerWeek;
    if (usual && max && (usual < 1 || max > 7 || max < usual)) errors['prefs.daysPerWeek'] = '天数需在 1–7 之间，且"最多"不能少于"通常"';
    const m = p.months;
    if (m.usual && m.max && (m.usual < 1 || m.max > 24 || m.max < m.usual)) errors['prefs.months'] = '时长需在 1–24 个月之间，且"最多"不能少于"通常"';
    if (p.internPayMin !== null && (p.internPayMin < 50 || p.internPayMin > 2000)) errors['prefs.internPayMin'] = '请填写 50–2000 之间的日薪，或选择"不限"';
    if (!p.internKinds.length) errors['prefs.jobType'] = '请至少选择一种实习类型';
  }
  if (needsCampus(d) && p.campusPayMin !== null && (p.campusPayMin < 2 || p.campusPayMin > 100)) errors['prefs.campusPayMin'] = '请填写 2–100 之间的月薪（千元），或选择"不限"';
  const y = d.basics.gradYear;
  if (y && (y < 2020 || y > 2035)) errors['basics.gradYear'] = '届别看起来不对，请检查';
  const overlap = p.cities.preferred.filter(c => p.cities.excluded.includes(c));
  if (overlap.length) errors['prefs.cities'] = `${overlap.join('、')}不能同时是首选和不考虑`;
  return errors;
}
