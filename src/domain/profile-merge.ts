// 字段来源与合并规则：用户确认 / 修改 > 补充文本解析 > 简历提取 > AI 推测
// 用户确认过的字段，任何自动流程都不能覆盖。
import type { Experience, FieldKey, FieldSources, ProfileData } from './profile';

/** 补充文本解析出的增量内容（只新增，不覆盖） */
export type SupplementChanges = {
  addSkills: string[];
  addExperiences: Experience[];
  avoid: string[];
  lines: string[]; // 给用户看的说明，如"新增技能 Spark（入门）"
};

export function applySupplement(data: ProfileData, sources: FieldSources, ch: SupplementChanges) {
  const next: ProfileData = structuredClone(data);
  const src: FieldSources = { ...sources };
  const newSkills = ch.addSkills.filter(s => !next.skills.some(x => x.toLowerCase() === s.toLowerCase()));
  if (newSkills.length) { next.skills.push(...newSkills); markSupplement(src, 'skills'); }
  if (ch.addExperiences.length) { next.experiences.push(...ch.addExperiences); markSupplement(src, 'experiences'); }
  const newAvoid = ch.avoid.filter(a => !next.prefs.avoid.includes(a));
  if (newAvoid.length) next.prefs.avoid.push(...newAvoid);
  return { data: next, sources: src };
}

function markSupplement(src: FieldSources, key: FieldKey) {
  // 已经是用户填写的字段保持"用户"来源，只在原来是简历 / AI / 缺失时标记为补充
  if (src[key]?.source !== 'user') src[key] = { source: 'supplement' };
}

/** 用户在确认页修改过的字段，来源改为"用户" */
export function markUserEdited(sources: FieldSources, keys: FieldKey[]): FieldSources {
  const next = { ...sources };
  for (const k of keys) next[k] = { source: 'user' };
  return next;
}
