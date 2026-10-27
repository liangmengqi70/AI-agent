// 投递渠道接口：Agent 通过这里提交投递、读取投递进度（只能看到已经发生的事件）
import type { ProfileData } from '@/domain/profile';

export type ApplicationStatus = 'waiting' | 'exam' | 'interview' | 'offer' | 'rejected' | 'no_response';
export type ApplicationEvent = { type: string; simDate: string; message: string | null; seen: boolean };
export type ApplicationView = {
  id: string; roundId: string; roundNo: number; jobId: string; tier: 'rec' | 'con';
  status: ApplicationStatus; appliedSim: string; lastEventSim: string | null;
  events: ApplicationEvent[];
};

export interface ApplyChannel {
  /** 提交投递（candidate 相当于投出去的简历），返回新建的投递数 */
  submit(visitorId: string, roundId: string, items: Array<{ jobId: string; tier: 'rec' | 'con' }>, simDate: string, candidate: ProfileData): Promise<number>;
  /** 读取访客的全部投递及已发生的事件 */
  list(visitorId: string): Promise<ApplicationView[]>;
  /** 某公司本招聘季已投递的数量 */
  countByCompany(visitorId: string): Promise<Map<string, number>>;
  markSeen(visitorId: string, applicationId: string): Promise<void>;
}
