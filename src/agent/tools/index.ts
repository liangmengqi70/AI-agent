// 复盘 Agent 可用的工具清单（8 个只读 + 1 个写入"待确认建议"）
import type { Tool } from './types';
import { checkSampleSize, compareJobs, getApplicationDetail, getRejectionMessages, getRoundStats, getSkipReasons, getStrategyHistory, queryOutcomes } from './query-tools';
import { proposeChange } from './propose-change';

export const REVIEW_TOOLS = [
  getRoundStats, queryOutcomes, getRejectionMessages, getSkipReasons, getApplicationDetail,
  compareJobs, checkSampleSize, getStrategyHistory, proposeChange,
] as unknown as Tool[];

export type { Tool, ToolContext } from './types';
