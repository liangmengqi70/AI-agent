import { currentVisitor } from '@/lib/visitor';
import { errorResponse } from '@/lib/api';
import { reviewView } from '@/services/review-service';

// 复盘页：?round=N 查看指定轮次（默认最近一次复盘）
export async function GET(request: Request) {
  try {
    const visitor = await currentVisitor();
    if (!visitor) return Response.json(null);
    const round = Number(new URL(request.url).searchParams.get('round')) || undefined;
    return Response.json(await reviewView(visitor.id, round));
  } catch (error) {
    return errorResponse(error);
  }
}
