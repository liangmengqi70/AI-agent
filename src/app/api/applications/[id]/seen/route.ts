import { currentVisitor } from '@/lib/visitor';
import { errorResponse, UserFacingError } from '@/lib/api';
import { markApplicationSeen } from '@/services/apply-service';

// 打开投递详情后，去掉"新"标记
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const visitor = await currentVisitor();
    if (!visitor) throw new UserFacingError('会话已失效，请刷新页面', 401);
    const { id } = await params;
    await markApplicationSeen(visitor.id, id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
