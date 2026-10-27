import 'server-only';
// 模拟平台：唯一允许引用 simulator/ 的地方。只返回岗位公开信息，绝不返回隐藏真相。
import { db } from '@/db/pool';
import { currentSimDate } from '@/simulator/clock';
import { advanceClock } from '@/simulator/events';
import type { JobSource, PublicJob, SimClock } from '../types';

type Row = {
  id: string; company: string; company_type: PublicJob['companyType']; title: string; direction: string; city: string;
  job_type: PublicJob['jobType']; salary_min: number | null; salary_max: number | null; salary_unit: 'day' | 'month';
  days_per_week: number | null; months: number | null; grad_year: number | null; degree: string | null;
  deadline_sim: string | null; released_sim: string; jd_text: string;
};

export const mockJobSource: JobSource = {
  async listReleased(simDate) {
    const [rows] = await db().query(
      `SELECT id, company, company_type, title, direction, city, job_type, salary_min, salary_max, salary_unit,
              days_per_week, months, grad_year, degree, deadline_sim, released_sim, jd_text
       FROM jobs WHERE released_sim <= ? ORDER BY released_sim DESC, id`,
      [simDate],
    );
    return (rows as Row[]).map(r => ({
      id: r.id, company: r.company, companyType: r.company_type, title: r.title, direction: r.direction, city: r.city,
      jobType: r.job_type, salaryMin: r.salary_min, salaryMax: r.salary_max, salaryUnit: r.salary_unit,
      daysPerWeek: r.days_per_week, months: r.months, gradYear: r.grad_year, degree: r.degree,
      deadlineSim: r.deadline_sim, releasedSim: r.released_sim, jdText: r.jd_text,
    }));
  },
};

export const mockClock: SimClock = { current: currentSimDate, advance: advanceClock };
