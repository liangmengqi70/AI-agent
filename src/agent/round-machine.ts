// 轮次状态机：当前状态 + 动作 → 下一状态。不在表里的转换一律拒绝。
import type { RoundStatus } from '@/db/repos/rounds';

export type RoundAction =
  | 'generated'        // 推荐生成完成
  | 'regenerate'       // 本轮未投递时修改了画像 / 偏好，重新生成
  | 'apply'            // 确认投递
  | 'reviewStart'      // 满足复盘条件
  | 'reviewReady'      // 复盘生成完成
  | 'finish'           // 处理完调整建议
  | 'fail' | 'retry';

const TABLE: Partial<Record<RoundStatus, Partial<Record<RoundAction, RoundStatus>>>> = {
  generating: { generated: 'awaiting_apply', fail: 'failed' },
  awaiting_apply: { apply: 'tracking', regenerate: 'generating' },
  tracking: { reviewStart: 'reviewing' },
  reviewing: { reviewReady: 'awaiting_review_decision', fail: 'failed' },
  awaiting_review_decision: { finish: 'completed' },
  failed: { retry: 'generating' },
};

export function nextStatus(from: RoundStatus, action: RoundAction): RoundStatus {
  const to = TABLE[from]?.[action];
  if (!to) throw new Error(`轮次状态不允许这样变化：${from} --${action}-->`);
  return to;
}

/** 生成推荐的步骤顺序（每一步一个文件，见 agent/steps） */
export const GENERATE_STEPS = ['screen', 'parse', 'match', 'tiers', 'arrange', 'questions'] as const;
export type GenerateStep = typeof GENERATE_STEPS[number];
