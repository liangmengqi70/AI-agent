import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from '@/db/pool';

// 匿名身份：浏览器 Cookie 中保存随机 token，数据库只存它的哈希
const COOKIE = 'ja_vid';
const MAX_AGE = 60 * 60 * 24 * 30; // Cookie 保留 30 天；数据 7 天未访问会被清理

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export type Visitor = { id: string; kind: 'user' | 'demo' };

/** 读取当前访客；不存在且 create=true 时新建 */
export async function currentVisitor(create = false): Promise<Visitor | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const [rows] = await db().query('SELECT id, kind FROM visitors WHERE token_hash = ?', [hash(token)]);
    const row = (rows as Visitor[])[0];
    if (row) {
      await db().query('UPDATE visitors SET last_seen_at = NOW() WHERE id = ?', [row.id]);
      return row;
    }
  }
  if (!create) return null;
  const newToken = randomBytes(24).toString('base64url');
  const [result] = await db().query('INSERT INTO visitors (token_hash) VALUES (?)', [hash(newToken)]);
  jar.set(COOKIE, newToken, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: MAX_AGE, secure: process.env.NODE_ENV === 'production' });
  return { id: String((result as { insertId: number }).insertId), kind: 'user' };
}
