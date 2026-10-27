import { currentVisitor } from '@/lib/visitor';
import { errorResponse, UserFacingError } from '@/lib/api';
import { autosave, loadForConfirm } from '@/services/profile-service';

// GET：读取要确认 / 修改的画像；mode=edit 时从已确认的版本复制出新草稿
export async function GET(request: Request) {
  try {
    const visitor = await currentVisitor();
    if (!visitor) throw new UserFacingError('还没有上传简历', 404);
    const mode = new URL(request.url).searchParams.get('mode') === 'edit' ? 'edit' : 'first';
    const profile = await loadForConfirm(visitor.id, mode);
    if (!profile) throw new UserFacingError('还没有上传简历', 404);
    return Response.json(profile);
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT：自动保存草稿
export async function PUT(request: Request) {
  try {
    const visitor = await currentVisitor();
    if (!visitor) throw new UserFacingError('会话已失效，请刷新页面', 401);
    const body = await request.json();
    await autosave(visitor.id, Number(body.version), body.data, body.sources ?? {}, String(body.supplement ?? ''));
    return Response.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (error) {
    return errorResponse(error);
  }
}
