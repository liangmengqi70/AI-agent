import 'server-only';
// 推进模拟时间：只有投递之后（跟踪中）才能推进；推进后把新发生的结果记入步骤记录
import { UserFacingError } from '@/lib/api';
import { simClock } from '@/platform';
import { addStep, currentRound } from '@/db/repos/rounds';
import { maybeStartReview } from './review-service';

const EVENT_TEXT: Record<string, string> = { exam_notice: '笔试 / 测评通知', interview: '面试邀请', offer: 'Offer', rejected: '拒信' };

export async function advanceTime(visitorId: string, days: number) {
  if (![1, 7].includes(days)) throw new UserFacingError('只能推进 1 天或 7 天');
  const round = await currentRound(visitorId);
  if (!round || round.status !== 'tracking') throw new UserFacingError('先确认本轮投递，再推进时间', 409);

  const r = await simClock.advance(visitorId, days);
  const counts = new Map<string, number>();
  for (const e of r.released) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const parts = [...counts.entries()].map(([t, n]) => { const text = EVENT_TEXT[t] ?? t; return `${n} 个${/^[A-Za-z]/.test(text) ? ' ' : ''}${text}`; });
  if (r.noResponse) parts.push(`${r.noResponse} 个标记为无回应`);
  const summary = parts.length ? `收到 ${parts.join('、')}` : '这段时间没有新消息';
  await addStep(round.id, 'advance', 'user', `推进 ${days} 天`, `${r.from} → ${r.to}：${summary}`, '模拟平台只释放日期已到的事件；投递 7 天没有任何消息的标记为"无回应"。');
  const reviewStarted = await maybeStartReview(visitorId); // 满足复盘条件时自动开始复盘
  return { date: r.to, summary, newEvents: r.released.length + r.noResponse, reviewStarted };
}
