import { currentVisitor } from '@/lib/visitor';
import { errorResponse, UserFacingError } from '@/lib/api';
import { advanceTime } from '@/services/clock-service';

// 推进模拟时间（1 天 / 7 天）
export async function POST(request: Request) {
  try {
    const visitor = await currentVisitor();
    if (!visitor) throw new UserFacingError('会话已失效，请刷新页面', 401);
    const { days } = await request.json();
    return Response.json(await advanceTime(visitor.id, Number(days)));
  } catch (error) {
    return errorResponse(error);
  }
}
