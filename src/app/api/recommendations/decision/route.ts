import { currentVisitor } from '@/lib/visitor';
import { errorResponse, UserFacingError } from '@/lib/api';
import { decide } from '@/services/apply-service';

// 推荐页：勾选投递 / 取消 / 跳过（可带说明）
export async function POST(request: Request) {
  try {
    const visitor = await currentVisitor();
    if (!visitor) throw new UserFacingError('会话已失效，请刷新页面', 401);
    const body = await request.json();
    const decision = body.decision;
    if (!['selected', 'skipped', 'untouched'].includes(decision)) throw new UserFacingError('操作不正确');
    const jobIds = (Array.isArray(body.jobIds) ? body.jobIds : [body.jobId]).map(String);
    return Response.json(await decide(visitor.id, {
      jobIds, decision,
      skipQuick: Array.isArray(body.skipQuick) ? body.skipQuick.map(String) : undefined,
      skipNote: typeof body.skipNote === 'string' ? body.skipNote : undefined,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
