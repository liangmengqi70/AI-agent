import { currentVisitor } from '@/lib/visitor';
import { errorResponse } from '@/lib/api';
import { latestConfirmedVersion } from '@/db/repos/profiles';

// 首页用：当前浏览器是否已有确认过的画像（决定是否显示"继续上次的求职"）
export async function GET() {
  try {
    const visitor = await currentVisitor();
    if (!visitor) return Response.json({ hasProfile: false });
    return Response.json({ hasProfile: (await latestConfirmedVersion(visitor.id)) > 0 });
  } catch (error) {
    return errorResponse(error);
  }
}
