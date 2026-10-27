import { jobSource } from '@/platform';
import { salaryReference } from '@/domain/market';
import { errorResponse } from '@/lib/api';

// 薪资市场参考：/api/market/salary?unit=day&directions=后端开发,数据开发&cities=北京,上海
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const unit = q.get('unit') === 'month' ? 'month' : 'day';
    const list = (k: string) => (q.get(k) ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const jobs = await jobSource.listReleased('9999-12-31'); // 参考整个岗位库（含之后才上线的岗位）
    return Response.json(salaryReference(jobs, unit, list('directions'), list('cities')));
  } catch (error) {
    return errorResponse(error);
  }
}
