import 'server-only';
import { db } from '@/db/pool';
import { UserFacingError } from '@/lib/api';

// 每日大模型调用上限（沿用 ResumeIQ 的做法）：按最近 24 小时的调用次数计算。
// 环境变量为空时：开发环境不限制，生产环境使用默认值；设为 0 表示不限制。
function limitFrom(name: string, productionDefault: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return process.env.NODE_ENV === 'production' ? productionDefault : 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** 一轮推荐 + 复盘大约 35 次调用；默认每个访客每天约 6 轮，全站每天约 100 轮 */
export const QUOTA = {
  global: () => limitFrom('AI_DAILY_GLOBAL_CALLS', 3500),
  visitor: () => limitFrom('AI_DAILY_VISITOR_CALLS', 200),
};

export class QuotaError extends UserFacingError {}

export async function assertLlmQuota(visitorId: string | null | undefined) {
  const globalLimit = QUOTA.global();
  const visitorLimit = QUOTA.visitor();
  if (globalLimit) {
    const [rows] = await db().query('SELECT COUNT(*) AS n FROM llm_calls WHERE created_at >= NOW() - INTERVAL 1 DAY');
    if (Number((rows as Array<{ n: number }>)[0].n) >= globalLimit) throw new QuotaError('今天的 AI 体验次数已用完，请明天再来', 429);
  }
  if (visitorLimit && visitorId) {
    const [rows] = await db().query('SELECT COUNT(*) AS n FROM llm_calls WHERE visitor_id = ? AND created_at >= NOW() - INTERVAL 1 DAY', [visitorId]);
    if (Number((rows as Array<{ n: number }>)[0].n) >= visitorLimit) throw new QuotaError('你今天使用 AI 的次数已达上限，请明天再继续', 429);
  }
}
