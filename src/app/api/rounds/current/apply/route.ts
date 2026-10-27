import { currentVisitor } from '@/lib/visitor';
import { errorResponse, UserFacingError } from '@/lib/api';
import { confirmApply } from '@/services/apply-service';
import { currentRound } from '@/db/repos/rounds';
import { getStrategy } from '@/db/repos/strategies';

// 确认投递：检查重复、截止、同公司上限、本轮上限，通过后提交
export async function POST() {
  try {
    const visitor = await currentVisitor();
    if (!visitor) throw new UserFacingError('会话已失效，请刷新页面', 401);
    const round = await currentRound(visitor.id);
    if (!round) throw new UserFacingError('还没有开始第 1 轮');
    const params = await getStrategy(visitor.id, round.strategy_version);
    return Response.json(await confirmApply(visitor.id, params));
  } catch (error) {
    return errorResponse(error);
  }
}
