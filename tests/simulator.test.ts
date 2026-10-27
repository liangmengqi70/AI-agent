// 模拟器测试：固定种子可复现；关键词判断合理；结果分布大致符合设定
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { candidateText, checkRequirement } from '../src/simulator/candidate';
import { planOutcome } from '../src/simulator/outcome';
import { addDays, seeded } from '../src/simulator/rng';
import { emptyProfile } from '../src/domain/profile';
import type { SeedJob } from '../src/simulator/types';

const jobs = JSON.parse(readFileSync('data/jobs/jobs.json', 'utf8')) as SeedJob[];

function backendStudent() {
  const p = emptyProfile();
  p.basics = { school: '某大学', degree: '本科', major: '计算机科学与技术', gradYear: 2027 };
  p.skills = ['Java', 'Spring Boot', 'MySQL', 'Redis', 'Linux', 'Git'];
  p.courses = ['数据结构', '操作系统', '计算机网络'];
  p.experiences = [{ kind: 'project', title: '校园二手交易平台', role: '后端开发', period: '', detail: '负责接口和数据库设计', tech: ['Java', 'MySQL'] }];
  p.prefs.daysPerWeek = { usual: 4, max: 5 }; p.prefs.months = { usual: 6, max: 6 };
  return p;
}
const plan = (job: SeedJob, seed: string, candidate = backendStudent()) => planOutcome({
  truth: job.truth, candidate, appliedSim: '2026-03-03', seed,
  job: { company: job.company, title: job.title, jobType: job.jobType, daysPerWeek: job.daysPerWeek, months: job.months },
});

test('固定种子：同一访客投同一岗位，结果完全相同', () => {
  const job = jobs[0];
  assert.deepEqual(plan(job, 'v1:1'), plan(job, 'v1:1'));
  assert.equal(seeded('a').next(), seeded('a').next());
});

test('日期计算跨月正确', () => {
  assert.equal(addDays('2026-03-30', 3), '2026-04-02');
});

test('关键词判断：技能命中、缺失、软性要求不卡、短词不误命中', () => {
  const c = candidateText(backendStudent());
  assert.equal(checkRequirement('熟悉 Java 或 Go 语言', c), 'met');
  assert.equal(checkRequirement('扎实的计算机网络基础', c), 'met');
  assert.equal(checkRequirement('熟悉 Spark 或 Hive', c), 'missing');
  assert.equal(checkRequirement('有后端实习经历', c), 'missing'); // 只有项目，没有实习
  assert.equal(checkRequirement('较强的逻辑思维和沟通能力', c), 'soft');
  const p = backendStudent(); p.skills = ['MongoDB']; p.experiences = [];
  assert.equal(checkRequirement('熟悉 Java 或 Go 语言', candidateText(p)), 'missing'); // mongo 不算 go
});

test('事件按时间顺序，且以 offer / 拒信 / 无事件结束', () => {
  for (const [i, job] of jobs.slice(0, 60).entries()) {
    const ev = plan(job, `v:${i}`);
    for (let k = 1; k < ev.length; k++) assert.ok(ev[k].simDate >= ev[k - 1].simDate);
    if (ev.length) assert.ok(['offer', 'rejected', 'exam_notice', 'interview'].includes(ev[ev.length - 1].type));
    if (ev.length) assert.ok(['offer', 'rejected'].includes(ev[ev.length - 1].type), `${job.title} 结果路径没有结束`);
  }
});

test('分布：对口候选人投后端岗位的回应率明显高于投不对口的岗位', () => {
  const rate = (list: SeedJob[]) => {
    let ok = 0, n = 0;
    for (const job of list) for (let s = 0; s < 20; s++) {
      const ev = plan(job, `x:${job.key}:${s}`);
      n++; if (ev.some(e => e.type === 'interview' || e.type === 'exam_notice')) ok++;
    }
    return ok / n;
  };
  const fit = rate(jobs.filter(j => j.direction === '后端开发'));
  const off = rate(jobs.filter(j => j.direction === '算法'));
  assert.ok(fit > off + 0.15, `对口 ${fit.toFixed(2)} vs 不对口 ${off.toFixed(2)}`);
  assert.ok(fit < 0.9, `对口岗位也不应该几乎全过：${fit.toFixed(2)}`);
});
