import { currentVisitor } from '@/lib/visitor';
import { errorResponse, UserFacingError } from '@/lib/api';
import { decideProposal } from '@/services/review-service';

// 采纳 / 不采纳 / 撤销（decision = accepted | rejected | pending）
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const visitor = await currentVisitor();
    if (!visitor) throw new UserFacingError('会话已失效，请刷新页面', 401);
    const { id } = await params;
    const { decision } = await request.json();
    if (!['accepted', 'rejected', 'pending'].includes(decision)) throw new UserFacingError('操作不正确');
    return Response.json(await decideProposal(visitor.id, id, decision));
  } catch (error) {
    return errorResponse(error);
  }
}
