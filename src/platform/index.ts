import 'server-only';
// 当前使用的平台实现（将来替换为真实数据源时只改这里）
export { mockJobSource as jobSource, mockClock as simClock } from './mock';
export { mockApplyChannel as applyChannel } from './mock/apply-channel';
export type { PublicJob } from './types';
export type { ApplicationView, ApplicationStatus } from './apply-types';
