// 每个方向"真正卡人"的必须项（隐藏真相的一部分，Agent 看不到）。
// 岗位 JD 把它写成必须项时，招聘方会严格执行：缺了基本过不了简历关，拒信也常点名；其他必须项则会放宽。
// Agent 需要从结果中分辨出哪一项才是真正卡人的。
export const KEY_REQUIREMENTS: Record<string, string> = {
  后端开发: '良好的数据结构与算法基础',
  数据开发: '熟悉 Spark 或 Hive',
  前端开发: '熟悉 React 或 Vue',
  算法: '熟悉 PyTorch 或 TensorFlow',
  'AI 应用开发': '了解大模型 API 调用和 Prompt 设计',
  测试开发: '了解软件测试方法',
  产品经理: '能独立完成需求文档和原型',
  'AI 产品经理': '了解大模型基本原理和应用场景',
  产品运营: '较强的数据分析能力',
  内容运营: '有内容创作经验',
  新媒体运营: '有账号运营经验',
  用户运营: '具备数据分析意识',
  市场营销: '有活动策划经验',
  'UI / UX 设计': '有完整作品集',
};

/** 岗位的卡人项：方向的关键要求出现在 JD 必须项中时才生效 */
export function keyMustOf(direction: string, writtenMust: readonly string[]): string | null {
  const key = KEY_REQUIREMENTS[direction];
  return key && writtenMust.includes(key) ? key : null;
}
