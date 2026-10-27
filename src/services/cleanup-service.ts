import 'server-only';
import { db } from '@/db/pool';

// 数据清理：超过 7 天未访问的访客连同全部数据一起删除（外键级联删除画像、轮次、投递、复盘等）。
// 大模型调用记录 llm_calls 只有次数和 token，不含简历内容，保留用于成本统计。
export const INACTIVE_DAYS = Number(process.env.VISITOR_RETENTION_DAYS || 7);
const EVERY_MS = 6 * 60 * 60 * 1000;

export async function cleanupInactiveVisitors() {
  const [r] = await db().query('DELETE FROM visitors WHERE last_seen_at < NOW() - INTERVAL ? DAY', [INACTIVE_DAYS]);
  const n = (r as { affectedRows: number }).affectedRows;
  if (n) console.log(`数据清理：删除 ${n} 个超过 ${INACTIVE_DAYS} 天未访问的访客`);
  return n;
}

/** 服务启动时执行一次，之后每 6 小时执行一次（单实例部署足够）。
 *  默认只在生产环境运行，避免误删本地开发数据；VISITOR_CLEANUP=on 可在本地强制开启，=off 可关闭。 */
export function scheduleCleanup() {
  const flag = process.env.VISITOR_CLEANUP?.trim();
  if (flag === 'off' || (process.env.NODE_ENV !== 'production' && flag !== 'on')) return;
  const g = globalThis as unknown as { jobagentCleanup?: ReturnType<typeof setInterval> };
  if (g.jobagentCleanup) return; // 开发时热更新不重复注册
  const run = () => cleanupInactiveVisitors().catch(e => console.error('数据清理失败', e));
  void run();
  g.jobagentCleanup = setInterval(run, EVERY_MS);
}
