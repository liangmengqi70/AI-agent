import { currentVisitor } from '@/lib/visitor';
import { errorResponse, UserFacingError } from '@/lib/api';
import { retryRound } from '@/services/round-service';

// 生成失败后重试：从失败的那一步继续
export async function POST() {
  try {
    const visitor = await currentVisitor();
    if (!visitor) throw new UserFacingError('会话已失效，请刷新页面', 401);
    await retryRound(visitor.id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
