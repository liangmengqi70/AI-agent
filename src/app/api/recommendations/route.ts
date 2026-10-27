import { currentVisitor } from '@/lib/visitor';
import { errorResponse } from '@/lib/api';
import { recommendations } from '@/services/round-service';

// 本轮推荐列表（推荐 / 可以考虑）及逐条依据
export async function GET() {
  try {
    const visitor = await currentVisitor();
    if (!visitor) return Response.json(null);
    return Response.json(await recommendations(visitor.id));
  } catch (error) {
    return errorResponse(error);
  }
}
