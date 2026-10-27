import 'server-only';
import { db } from '../pool';
import { profileDataSchema, type FieldSources, type ProfileData } from '@/domain/profile';

// 画像表 profiles 的读写
export type ProfileRow = {
  id: string; version: number; status: 'draft' | 'confirmed';
  data: ProfileData; field_sources: FieldSources; supplement_text: string | null; confirmed_at: string | null;
};

export async function latestProfile(visitorId: string): Promise<ProfileRow | null> {
  const [rows] = await db().query(
    'SELECT id, version, status, data, field_sources, supplement_text, confirmed_at FROM profiles WHERE visitor_id = ? ORDER BY version DESC LIMIT 1',
    [visitorId],
  );
  const row = (rows as ProfileRow[])[0];
  if (!row) return null;
  // 旧版本数据可能缺少后来新增的字段，读取时按当前结构补上默认值
  const parsed = profileDataSchema.safeParse(row.data);
  return parsed.success ? { ...row, data: parsed.data } : row;
}

export async function getProfileVersion(visitorId: string, version: number): Promise<ProfileData | null> {
  const [rows] = await db().query('SELECT data FROM profiles WHERE visitor_id = ? AND version = ?', [visitorId, version]);
  const data = (rows as Array<{ data: ProfileData }>)[0]?.data;
  return data ? profileDataSchema.parse(data) : null;
}

export async function getProfileRow(visitorId: string, version: number): Promise<{ data: ProfileData; sources: FieldSources } | null> {
  const [rows] = await db().query('SELECT data, field_sources FROM profiles WHERE visitor_id = ? AND version = ?', [visitorId, version]);
  const row = (rows as Array<{ data: ProfileData; field_sources: FieldSources | null }>)[0];
  return row ? { data: profileDataSchema.parse(row.data), sources: row.field_sources ?? {} } : null;
}

export async function latestConfirmedVersion(visitorId: string): Promise<number> {
  const [rows] = await db().query("SELECT MAX(version) AS v FROM profiles WHERE visitor_id = ? AND status = 'confirmed'", [visitorId]);
  return Number((rows as Array<{ v: number | null }>)[0]?.v ?? 0);
}

/** 新建一个草稿版本（上传简历后，或开始修改已确认的画像时） */
export async function createDraft(visitorId: string, resumeId: string | null, data: ProfileData, sources: FieldSources): Promise<number> {
  const [rows] = await db().query('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM profiles WHERE visitor_id = ?', [visitorId]);
  const version = Number((rows as Array<{ v: number }>)[0].v);
  await db().query(
    'INSERT INTO profiles (visitor_id, version, status, resume_id, data, field_sources) VALUES (?, ?, \'draft\', ?, ?, ?)',
    [visitorId, version, resumeId, JSON.stringify(data), JSON.stringify(sources)],
  );
  return version;
}

/** 直接生成一个已确认的新版本（如回答合并提问时更新偏好） */
export async function createConfirmedVersion(visitorId: string, data: ProfileData, sources: FieldSources): Promise<number> {
  const version = await createDraft(visitorId, null, data, sources);
  await db().query("UPDATE profiles SET status = 'confirmed', confirmed_at = NOW() WHERE visitor_id = ? AND version = ?", [visitorId, version]);
  return version;
}

/** 更新草稿（自动保存）；已确认的版本不能改 */
export async function saveDraft(visitorId: string, version: number, data: ProfileData, sources: FieldSources, supplement: string | null) {
  const [result] = await db().query(
    "UPDATE profiles SET data = ?, field_sources = ?, supplement_text = ? WHERE visitor_id = ? AND version = ? AND status = 'draft'",
    [JSON.stringify(data), JSON.stringify(sources), supplement, visitorId, version],
  );
  return (result as { affectedRows: number }).affectedRows > 0;
}

export async function confirmDraft(visitorId: string, version: number, data: ProfileData, sources: FieldSources, supplement: string | null) {
  await db().query(
    "UPDATE profiles SET data = ?, field_sources = ?, supplement_text = ?, status = 'confirmed', confirmed_at = NOW() WHERE visitor_id = ? AND version = ? AND status = 'draft'",
    [JSON.stringify(data), JSON.stringify(sources), supplement, visitorId, version],
  );
}
