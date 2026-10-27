// 服务启动时执行一次：继续执行上次中断的轮次和复盘（断点续跑），并启动定期数据清理
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { resumePendingRounds } = await import('./agent/runner');
    const { resumePendingReviews } = await import('./agent/review-runner');
    const { scheduleCleanup } = await import('./services/cleanup-service');
    await resumePendingRounds();
    await resumePendingReviews();
    scheduleCleanup(); // 超过 7 天未访问的访客数据定期删除
  } catch (error) {
    console.error('恢复中断的轮次失败', error);
  }
}
