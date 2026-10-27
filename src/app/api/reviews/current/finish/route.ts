import { currentVisitor } from '@/lib/visitor';
import { errorResponse, UserFacingError } from '@/lib/api';
import { finishReviewAndStartNext } from '@/services/review-service';

// 处理完复盘建议：生成新策略（如有采纳）并开始下一轮
export async function POST() {
  try {
    const visitor = await currentVisitor();
    if (!visitor) throw new UserFacingError('会话已失效，请刷新页面', 401);
    return Response.json(await finishReviewAndStartNext(visitor.id));
  } catch (error) {
    return errorResponse(error);
  }
}
