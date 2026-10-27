// 接口通用：统一的错误返回格式 { error: 给用户看的中文提示 }
export class UserFacingError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function errorResponse(error: unknown) {
  if (error instanceof UserFacingError) return Response.json({ error: error.message }, { status: error.status });
  console.error(error);
  return Response.json({ error: '服务出了点问题，请稍后重试' }, { status: 500 });
}
