// 招聘平台接口：Agent 只能通过这里获取岗位和结果，看不到隐藏真相。
// 现在的实现是 platform/mock（模拟平台）；将来接真实数据源时，只需新写一个实现。

import type { PublicJob } from '@/domain/job';
export type { PublicJob };

export interface JobSource {
  /** 某个模拟日期时已上线的全部岗位 */
  listReleased(simDate: string): Promise<PublicJob[]>;
}

export interface SimClock {
  /** 读取访客当前的模拟日期；不存在时初始化为招聘季起点 */
  current(visitorId: string): Promise<{ date: string; season: string }>;
  /** 推进模拟时间：返回这段时间里新发生的投递事件 */
  advance(visitorId: string, days: number): Promise<{ from: string; to: string; released: Array<{ applicationId: string; type: string }>; noResponse: number }>;
}
