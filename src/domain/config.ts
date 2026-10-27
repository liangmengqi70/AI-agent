// 所有规则参数的默认值集中在这里，修改规则时只改这个文件。

/** 每个访客每天可上传简历的次数（含重新上传） */
export const UPLOAD_DAILY_LIMIT = Number(process.env.UPLOAD_DAILY_LIMIT || 3);

/** 简历文字少于这个字数时，退回普通表单手动填写 */
export const MIN_RESUME_CHARS = 200;

/** 策略参数的默认值（策略 v1 使用；之后由复盘建议调整） */
export const DEFAULT_STRATEGY_PARAMS = {
  tierRules: {
    maxPartialMust: 1,     // "推荐"档：必须项最多允许几项"部分满足"
    minBonusRatio: 0.5,    // "推荐"档：加分项至少满足的比例
    maxMissingMustForCon: 1, // 必须项"不满足"不超过几项时，降为"可以考虑"而不是"不推荐"
  },
  downgradeRules: [] as Array<{ keyword: string; fromRound?: number }>, // 复盘新增：必须项含该关键词且用户不具备 → 不推荐
  exploreRatio: 0.2,       // 探索岗位比例
  exploreRatioMin: 0.1,    // 探索比例下限（护栏）
  coarseTopN: 20,          // 粗筛后进入大模型分析的岗位数
  questionThreshold: 5,    // 同一可调整约束影响多少个岗位时合并提问一次
  roundApplyLimit: 25,     // 每轮最多投递数
  sameCompanyLimit: 2,     // 同一公司每季最多投递数
};
export type StrategyParams = typeof DEFAULT_STRATEGY_PARAMS;
