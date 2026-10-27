// 薪资市场参考（纯函数）：按用户选的方向和城市，统计岗位库里的薪资范围
import type { PublicJob } from './job';

export type SalaryRef = { count: number; p25: number; median: number; p75: number; scope: string } | null;

function pct(sorted: number[], q: number) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo));
}

/** 用每个岗位薪资区间的中点做统计；样本少于 5 个时放宽到"只按方向"，仍不足则放宽到全部 */
export function salaryReference(jobs: PublicJob[], unit: 'day' | 'month', directions: string[], cities: string[]): SalaryRef {
  const pool = jobs.filter(j => j.salaryUnit === unit && j.salaryMin && j.salaryMax);
  const attempts: Array<[string, PublicJob[]]> = [
    ['你选的方向和城市', pool.filter(j => directions.includes(j.direction) && (!cities.length || cities.includes(j.city)))],
    ['你选的方向', pool.filter(j => directions.includes(j.direction))],
    ['全部岗位', pool],
  ];
  for (const [scope, list] of attempts) {
    if (list.length < 5) continue;
    const mids = list.map(j => (j.salaryMin! + j.salaryMax!) / 2).sort((a, b) => a - b);
    return { count: list.length, p25: pct(mids, 0.25), median: pct(mids, 0.5), p75: pct(mids, 0.75), scope };
  }
  return null;
}
