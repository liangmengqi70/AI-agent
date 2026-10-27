import { currentVisitor } from '@/lib/visitor';
import { errorResponse } from '@/lib/api';
import { listApplications } from '@/services/apply-service';

// 投递进度：全部投递及已经发生的状态变化
export async function GET() {
  try {
    const visitor = await currentVisitor();
    if (!visitor) return Response.json({ simDate: null, items: [] });
    return Response.json(await listApplications(visitor.id));
  } catch (error) {
    return errorResponse(error);
  }
}
