// 模拟器结果分布统计：用一个后端方向的示例候选人，投各方向岗位各 20 次，看回应率、面试率、Offer 率。
// 调整 src/simulator/outcome.ts 中的参数 P 后运行：npx tsx scripts/sim-stats.mts
import { readFileSync } from 'node:fs';
import { planOutcome } from '../src/simulator/outcome.ts';
import { emptyProfile } from '../src/domain/profile.ts';
import type { SeedJob } from '../src/simulator/types.ts';

const jobs = JSON.parse(readFileSync('data/jobs/jobs.json', 'utf8')) as SeedJob[];
const p = emptyProfile();
p.basics = { school: '某大学', degree: '本科', major: '计算机科学与技术', gradYear: 2027 };
p.skills = ['Java', 'Spring Boot', 'MySQL', 'Redis', 'Linux', 'Git'];
p.courses = ['数据结构', '操作系统', '计算机网络'];
p.experiences = [{ kind: 'project', title: '校园二手交易平台', role: '后端开发', period: '', detail: '', tech: ['Java', 'MySQL'] }];
p.prefs.daysPerWeek = { usual: 4, max: 5 }; p.prefs.months = { usual: 6, max: 6 };

for (const dir of [...new Set(jobs.map(j => j.direction))]) {
  const c = { silent: 0, rejResume: 0, cited: 0, exam: 0, interview: 0, offer: 0, n: 0 };
  for (const j of jobs.filter(x => x.direction === dir)) for (let s = 0; s < 20; s++) {
    const ev = planOutcome({
      truth: j.truth, candidate: p, appliedSim: '2026-03-03', seed: `${j.key}:${s}`,
      job: { company: j.company, title: j.title, jobType: j.jobType, daysPerWeek: j.daysPerWeek, months: j.months },
    });
    c.n++;
    if (!ev.length) c.silent++;
    else if (ev[0].type === 'rejected') { c.rejResume++; if (ev[0].message.includes('看重')) c.cited++; }
    if (ev.some(e => e.type === 'exam_notice')) c.exam++;
    if (ev.some(e => e.type === 'interview')) c.interview++;
    if (ev.some(e => e.type === 'offer')) c.offer++;
  }
  const pct = (x: number) => `${Math.round((100 * x) / c.n)}%`.padStart(4);
  console.log(`${dir.padEnd(8, '　')} 无消息 ${pct(c.silent)}  简历被拒 ${pct(c.rejResume)}（写明原因 ${pct(c.cited)}）  笔试 ${pct(c.exam)}  面试 ${pct(c.interview)}  Offer ${pct(c.offer)}`);
}
