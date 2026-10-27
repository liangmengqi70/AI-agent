import { currentVisitor } from '@/lib/visitor';
import { errorResponse, UserFacingError } from '@/lib/api';
import { confirmProfile } from '@/services/profile-service';
import { applyProfileChange, assertCanEditProfile } from '@/services/round-service';

export const maxDuration = 120;

// 确认画像：校验 → 有补充文字时先解析给用户确认 → 保存为正式版本并生成策略 v1
export async function POST(request: Request) {
  try {
    const visitor = await currentVisitor();
    if (!visitor) throw new UserFacingError('会话已失效，请刷新页面', 401);
    const body = await request.json();
    await assertCanEditProfile(visitor.id);
    const result = await confirmProfile({
      visitorId: visitor.id,
      version: Number(body.version),
      data: body.data,
      sources: body.sources ?? {},
      supplement: String(body.supplement ?? ''),
      supplementParsed: !!body.supplementParsed,
    });
    // 第一次确认 → 开始第 1 轮；本轮未投递 → 重新生成本轮；本轮已投递 → 用于下一轮
    if (result.status === 'confirmed') return Response.json({ ...result, ...(await applyProfileChange(visitor.id, result.version)) });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
