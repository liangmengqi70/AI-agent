// 复盘工具的统一格式：名称、给大模型看的说明、参数格式、执行函数、大白话描述（记录在 agent_tool_calls，供内部评估页查看）
import type { ReviewData } from '../review/data';
import type { ReviewApp } from '@/domain/review';
import { groupLabel, stageOf, STAGE_CN, type Stage } from '@/domain/review';

export type ToolContext = { data: ReviewData; reviewId: string; rejections: Map<string, number> };

export type Tool<A = Record<string, unknown>> = {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  plain: (args: A, ctx: ToolContext) => string;
  run: (args: A, ctx: ToolContext) => Promise<unknown> | unknown;
};

/* ---------- 工具共用的筛选条件 ---------- */
export type AppFilter = { tier?: string; direction?: string; city?: string; companyType?: string; jobType?: string; stage?: string };

export const FILTER_SCHEMA = {
  type: 'object',
  properties: {
    tier: { type: 'string', description: '推荐 / 可以考虑' },
    direction: { type: 'string', description: '岗位方向，如 数据开发' },
    city: { type: 'string' },
    companyType: { type: 'string', description: '大厂 / 中型公司 / 创业公司 / 外企 / 外包' },
    jobType: { type: 'string', description: '日常实习 / 暑期实习 / 校招' },
    stage: { type: 'string', enum: Object.keys(STAGE_CN), description: '投递走到的阶段' },
  },
} as const;

export function filterApps(apps: ReviewApp[], f: AppFilter = {}) {
  return apps.filter(a =>
    (!f.tier || groupLabel('tier', a.tier) === f.tier) &&
    (!f.direction || a.direction === f.direction) &&
    (!f.city || a.city === f.city) &&
    (!f.companyType || groupLabel('companyType', a.companyType) === f.companyType) &&
    (!f.jobType || groupLabel('jobType', a.jobType) === f.jobType) &&
    (!f.stage || stageOf(a) === (f.stage as Stage)));
}

export function filterText(f: AppFilter = {}) {
  const parts = [f.direction, f.city, f.tier && `"${f.tier}"档`, f.companyType, f.jobType, f.stage && STAGE_CN[f.stage as Stage]].filter(Boolean);
  return parts.length ? parts.join('、') : '全部';
}
