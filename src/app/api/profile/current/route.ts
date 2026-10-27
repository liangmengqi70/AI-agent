import { currentVisitor } from '@/lib/visitor';
import { errorResponse } from '@/lib/api';
import { currentProfile } from '@/services/profile-service';
import { currentRound } from '@/db/repos/rounds';

// 工作台画像页：最新确认的画像（只读）
export async function GET() {
  try {
    const visitor = await currentVisitor();
    if (!visitor) return Response.json(null);
    const round = await currentRound(visitor.id);
    const profile = await currentProfile(visitor.id, round?.profile_version ?? null);
    return Response.json(profile && { ...profile, round: round && { no: round.round_no, status: round.status } });
  } catch (error) {
    return errorResponse(error);
  }
}
