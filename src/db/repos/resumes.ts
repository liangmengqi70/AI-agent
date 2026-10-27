import 'server-only';
import { db } from '../pool';

// 简历表 resumes：只保存提取出的文字，不保存原文件
export async function insertResume(visitorId: string, fileName: string, text: string): Promise<string> {
  const [result] = await db().query(
    "INSERT INTO resumes (visitor_id, file_name, text, char_count, status) VALUES (?, ?, ?, ?, 'done')",
    [visitorId, fileName, text, text.length],
  );
  return String((result as { insertId: number }).insertId);
}

export async function latestResumeName(visitorId: string): Promise<string | null> {
  const [rows] = await db().query('SELECT file_name FROM resumes WHERE visitor_id = ? ORDER BY id DESC LIMIT 1', [visitorId]);
  return (rows as Array<{ file_name: string }>)[0]?.file_name ?? null;
}
