import { currentVisitor } from '@/lib/visitor';
import { errorResponse } from '@/lib/api';
import { strategyView } from '@/services/strategy-service';

// 策略页：当前策略与版本历史
export async function GET() {
  try {
    const visitor = await currentVisitor();
    if (!visitor) return Response.json(null);
    return Response.json(await strategyView(visitor.id));
  } catch (error) {
    return errorResponse(error);
  }
}
