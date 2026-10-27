import 'server-only';
import { db } from '../pool';

// 每日用量计数 usage_counters
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }); // YYYY-MM-DD

export async function uploadsToday(visitorId: string): Promise<number> {
  const [rows] = await db().query('SELECT uploads FROM usage_counters WHERE visitor_id = ? AND day = ?', [visitorId, today()]);
  return Number((rows as Array<{ uploads: number }>)[0]?.uploads ?? 0);
}

export async function countUpload(visitorId: string) {
  await db().query(
    'INSERT INTO usage_counters (visitor_id, day, uploads) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE uploads = uploads + 1',
    [visitorId, today()],
  );
}
