import { currentVisitor } from '@/lib/visitor';
import { errorResponse } from '@/lib/api';
import { roundOverview } from '@/services/round-service';

// 当前轮次的状态与步骤（工作台每 2 秒轮询一次）
export async function GET() {
  try {
    const visitor = await currentVisitor();
    if (!visitor) return Response.json(null);
    return Response.json(await roundOverview(visitor.id));
  } catch (error) {
    return errorResponse(error);
  }
}
