import { currentVisitor } from '@/lib/visitor';
import { errorResponse, UserFacingError } from '@/lib/api';
import { answerQuestion } from '@/services/apply-service';

// 回答合并提问：可以 / 不行 / 只看本轮这些
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const visitor = await currentVisitor();
    if (!visitor) throw new UserFacingError('会话已失效，请刷新页面', 401);
    const { id } = await params;
    const { answer } = await request.json();
    if (!['accept', 'reject', 'keep_only'].includes(answer)) throw new UserFacingError('回答不正确');
    return Response.json(await answerQuestion(visitor.id, id, answer));
  } catch (error) {
    return errorResponse(error);
  }
}
