import 'server-only';
import { UserFacingError } from '@/lib/api';
import { extractResumeText, ResumeTextError } from '@/lib/resume-text';
import { MIN_RESUME_CHARS, UPLOAD_DAILY_LIMIT } from '@/domain/config';
import {
  completeness, emptyProfile, FIELD_KEYS, isFilled, profileDataSchema, validateProfile,
  type FieldKey, type FieldSources, type ProfileData,
} from '@/domain/profile';
import { applySupplement } from '@/domain/profile-merge';
import { extractProfile, type ExtractResult } from '@/llm/tasks/extract-profile';
import { parseSupplement } from '@/llm/tasks/parse-supplement';
import { suggestDirections } from '@/llm/tasks/suggest-directions';
import * as profiles from '@/db/repos/profiles';
import { insertResume } from '@/db/repos/resumes';
import { ensureInitialStrategy } from '@/db/repos/strategies';
import { countUpload, uploadsToday } from '@/db/repos/usage';
import { simClock } from '@/platform';

/* ========== 上传简历 → 提取文字 → 大模型整理画像 → 完整性检查 → 生成草稿 ========== */
export async function uploadResume(visitorId: string, file: File) {
  if (await uploadsToday(visitorId) >= UPLOAD_DAILY_LIMIT) {
    throw new UserFacingError(`今天的上传次数已用完（每天 ${UPLOAD_DAILY_LIMIT} 次），明天可以再试`, 429);
  }
  let text: string;
  try {
    text = await extractResumeText(file);
  } catch (error) {
    if (error instanceof ResumeTextError) throw new UserFacingError(error.message, 422);
    throw error;
  }
  await countUpload(visitorId);
  const resumeId = await insertResume(visitorId, file.name, text);

  // 文字太少：退回手动填写
  if (text.length < MIN_RESUME_CHARS) {
    const data = emptyProfile();
    const sources = missingSources(data);
    const version = await profiles.createDraft(visitorId, resumeId, data, sources);
    return { version, fileName: file.name, chars: text.length, manual: true, ...completeness(data, sources) };
  }

  const result = await extractProfile(text, visitorId);
  const { data, sources } = fromExtraction(result);
  await addExtendedDirections(data, sources, visitorId);
  const version = await profiles.createDraft(visitorId, resumeId, data, sources);
  return { version, fileName: file.name, chars: text.length, manual: false, ...completeness(data, sources) };
}

function fromExtraction(r: ExtractResult): { data: ProfileData; sources: FieldSources } {
  const data = emptyProfile();
  data.basics = r.basics;
  data.skills = r.skills.slice(0, 20);
  data.courses = r.courses;
  data.experiences = r.experiences;
  data.awards = r.awards;
  const sources: FieldSources = {};
  const inf = r.inferred;
  if (inf.jobType) { data.prefs.jobType = inf.jobType.value; sources['prefs.jobType'] = { source: 'ai', reason: inf.jobType.reason }; }
  if (inf.directions) {
    const preferred = [...new Set(inf.directions.value.preferred)];
    const acceptable = [...new Set(inf.directions.value.acceptable)].filter(x => !preferred.includes(x)); // 同一方向只保留在首选
    data.prefs.directions = { ...data.prefs.directions, preferred, acceptable };
    sources['prefs.directions'] = { source: 'ai', reason: inf.directions.reason };
  }
  if (inf.cities?.value.length) { data.prefs.cities.preferred = inf.cities.value; sources['prefs.cities'] = { source: 'ai', reason: inf.cities.reason }; }
  if (inf.months) { data.prefs.months = { usual: inf.months.value.usual, max: inf.months.value.max }; sources['prefs.months'] = { source: 'ai', reason: inf.months.reason }; }
  sources['prefs.valueConversion'] = { source: 'default' };
  sources['prefs.internPayMin'] = { source: 'default' }; // 薪资默认"不限"
  sources['prefs.campusPayMin'] = { source: 'default' };
  for (const key of FIELD_KEYS) {
    if (sources[key]) continue;
    sources[key] = { source: isFilled(data, key) && !key.startsWith('prefs.') ? 'resume' : 'missing' };
  }
  return { data, sources };
}

function missingSources(data: ProfileData): FieldSources {
  const s: FieldSources = {};
  const defaults = ['prefs.valueConversion', 'prefs.internPayMin', 'prefs.campusPayMin'];
  for (const key of FIELD_KEYS) s[key] = { source: defaults.includes(key) ? 'default' : isFilled(data, key) ? 'resume' : 'missing' };
  return s;
}

/* ========== 延伸方向：AI 根据技能推测用户没选、但可能适合的方向 ========== */
// 推测结果和依据记在 sources['prefs.directionsExtended']；这个键存在就表示推测过，不再重复推测
const EXT_KEY = 'prefs.directionsExtended';
async function addExtendedDirections(data: ProfileData, sources: FieldSources, visitorId: string) {
  try {
    const items = await suggestDirections(data, visitorId);
    data.prefs.directions.extended = items.map(i => i.direction);
    sources[EXT_KEY] = { source: 'ai', reason: items.map(i => `${i.direction}：${i.reason}`).join('；') };
  } catch (error) {
    console.error('延伸方向推测失败，跳过', error); // 不影响主流程
  }
}

/* ========== 读取草稿（首次确认）或进入修改模式 ========== */
export async function loadForConfirm(visitorId: string, mode: 'first' | 'edit') {
  const latest = await profiles.latestProfile(visitorId);
  if (!latest) return null;
  if (mode === 'edit' && latest.status === 'confirmed') {
    // 修改已确认的画像：复制为新草稿；之前确认过的字段来源统一视为"用户确认"
    const sources: FieldSources = {};
    for (const key of FIELD_KEYS) sources[key] = { source: 'user' };
    const data = profileDataSchema.parse(latest.data); // 补全旧版本缺少的新字段
    if (latest.field_sources[EXT_KEY]) sources[EXT_KEY] = latest.field_sources[EXT_KEY];
    else await addExtendedDirections(data, sources, visitorId); // 旧画像没推测过延伸方向，补上
    const version = await profiles.createDraft(visitorId, null, data, sources);
    return { version, data, sources, supplement: '', isEdit: true, ...completeness(data, sources) };
  }
  const isEdit = latest.version > 1;
  const data = profileDataSchema.parse(latest.data);
  const sources = { ...latest.field_sources };
  if (latest.status === 'draft' && !sources[EXT_KEY]) {
    await addExtendedDirections(data, sources, visitorId);
    await profiles.saveDraft(visitorId, latest.version, data, sources, latest.supplement_text);
  }
  return { version: latest.version, data, sources, supplement: latest.supplement_text ?? '', isEdit, ...completeness(data, sources) };
}

/* ========== 自动保存草稿 ========== */
export async function autosave(visitorId: string, version: number, rawData: unknown, sources: FieldSources, supplement: string) {
  const data = profileDataSchema.parse(rawData);
  await profiles.saveDraft(visitorId, version, data, sources, supplement || null);
}

/* ========== 确认：校验 →（有补充文字且没解析过）先解析给用户确认 → 保存为正式版本 ========== */
export async function confirmProfile(input: {
  visitorId: string; version: number; data: unknown; sources: FieldSources; supplement: string; supplementParsed: boolean;
}) {
  const parsed = profileDataSchema.safeParse(input.data);
  if (!parsed.success) throw new UserFacingError('提交的数据格式不正确，请刷新页面后重试');
  let data = parsed.data;
  let sources = input.sources;

  const errors = validateProfile(data);
  if (Object.keys(errors).length) return { status: 'invalid' as const, errors };

  const supplement = input.supplement.trim();
  if (supplement && !input.supplementParsed) {
    const changes = await parseSupplement(supplement, data, input.visitorId);
    ({ data, sources } = applySupplement(data, sources, changes));
    await profiles.saveDraft(input.visitorId, input.version, data, sources, supplement);
    return { status: 'parsed' as const, lines: changes.lines, data, sources };
  }

  await profiles.confirmDraft(input.visitorId, input.version, data, sources, supplement || null);
  await ensureInitialStrategy(input.visitorId);
  await simClock.current(input.visitorId); // 第一次确认时初始化模拟日期（春招起点）
  return { status: 'confirmed' as const, version: input.version };
}

/* ========== 工作台画像页：最新确认的画像，以及本轮实际使用的版本 ========== */
export async function currentProfile(visitorId: string, roundProfileVersion: number | null) {
  const version = await profiles.latestConfirmedVersion(visitorId);
  if (!version) return null;
  const row = await profiles.getProfileRow(visitorId, version);
  return { version, roundVersion: roundProfileVersion, data: row!.data, extendedReason: row!.sources[EXT_KEY]?.reason ?? null };
}

export type { FieldKey };
