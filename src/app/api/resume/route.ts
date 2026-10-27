import { currentVisitor } from '@/lib/visitor';
import { errorResponse, UserFacingError } from '@/lib/api';
import { uploadResume } from '@/services/profile-service';

export const maxDuration = 180;

// 上传简历：提取文字 → 大模型整理画像 → 生成草稿
export async function POST(request: Request) {
  try {
    const visitor = await currentVisitor(true);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new UserFacingError('没有收到简历文件，请重新选择');
    const result = await uploadResume(visitor!.id, file);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
