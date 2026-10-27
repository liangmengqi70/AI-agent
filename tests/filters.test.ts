// 硬过滤与粗筛的单元测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hardFilter, coarseScore, runFunnel } from '../src/domain/filters';
import { emptyProfile, type ProfileData } from '../src/domain/profile';
import type { PublicJob } from '../src/domain/job';

function profile(): ProfileData {
  const p = emptyProfile();
  p.basics = { school: '某大学', degree: '本科', major: '计算机', gradYear: 2027 };
  p.skills = ['Java', 'MySQL', 'Spark（入门）'];
  p.prefs.jobType = 'intern';
  p.prefs.directions = { preferred: ['后端开发'], acceptable: ['数据开发'], extended: [], excluded: [] };
  p.prefs.cities = { preferred: ['北京'], acceptable: ['杭州'], excluded: ['上海'], remoteOk: false, anyCity: false };
  p.prefs.internPayMin = 200;
  p.prefs.avoid = ['外包公司'];
  return p;
}
function job(over: Partial<PublicJob> = {}): PublicJob {
  return {
    id: '1', company: 'A', companyType: 'mid', title: '后端开发实习生', direction: '后端开发', city: '北京',
    jobType: 'daily_intern', salaryMin: 200, salaryMax: 300, salaryUnit: 'day', daysPerWeek: 3, months: 3,
    gradYear: 2027, degree: '本科', deadlineSim: null, releasedSim: '2026-02-24', jdText: '熟悉 Java，掌握 MySQL', ...over,
  };
}
const ctx = { simDate: '2026-03-03' };

test('符合条件的岗位通过硬过滤', () => assert.equal(hardFilter(profile(), job(), ctx), null));
test('过期岗位被排除', () => assert.equal(hardFilter(profile(), job({ deadlineSim: '2026-03-01' }), ctx), 'expired'));
test('只找实习时排除校招', () => assert.equal(hardFilter(profile(), job({ jobType: 'campus' }), ctx), 'jobType'));
test('届别不符被排除', () => assert.equal(hardFilter(profile(), job({ gradYear: 2026 }), ctx), 'gradYear'));
test('本科投硕士岗被排除', () => assert.equal(hardFilter(profile(), job({ degree: '硕士' }), ctx), 'degree'));
test('不考虑的城市被排除', () => assert.equal(hardFilter(profile(), job({ city: '上海' }), ctx), 'cityExcluded'));
test('意向外的城市被排除', () => assert.equal(hardFilter(profile(), job({ city: '成都' }), ctx), 'city'));
test('可接受城市可以通过', () => assert.equal(hardFilter(profile(), job({ city: '杭州' }), ctx), null));
test('城市不限时任何城市都能通过', () => {
  const p = profile(); p.prefs.cities.anyCity = true;
  assert.equal(hardFilter(p, job({ city: '成都' }), ctx), null);
});
test('方向不符被排除', () => assert.equal(hardFilter(profile(), job({ direction: '产品经理' }), ctx), 'direction'));
test('不考虑外包时排除外包公司', () => assert.equal(hardFilter(profile(), job({ companyType: 'outsourcing' }), ctx), 'avoid'));
test('薪资上限低于底线被排除', () => assert.equal(hardFilter(profile(), job({ salaryMax: 180 }), ctx), 'salary'));
test('同一公司投满后被排除', () =>
  assert.equal(hardFilter(profile(), job(), { ...ctx, companyApplyCount: new Map([['A', 2]]), sameCompanyLimit: 2 }), 'sameCompany'));

test('粗筛：首选方向 + 技能命中得分更高', () => {
  const a = coarseScore(profile(), job());
  const b = coarseScore(profile(), job({ direction: '数据开发', jdText: '熟悉 Hive' }));
  assert.ok(a.score > b.score);
  assert.equal(a.skillHits, 2);
});
test('粗筛：技能括号里的说明不影响匹配', () => {
  assert.equal(coarseScore(profile(), job({ jdText: '熟悉 Spark 或 Hive' })).skillHits, 1);
});
test('延伸方向的岗位可以通过硬过滤', () => {
  const p = profile(); p.prefs.directions.extended = ['AI 应用开发'];
  assert.equal(hardFilter(p, job({ direction: 'AI 应用开发' }), ctx), null);
});
test('用户删除过的方向被排除', () => {
  const p = profile(); p.prefs.directions.excluded = ['AI 应用开发'];
  assert.equal(hardFilter(p, job({ direction: 'AI 应用开发' }), ctx), 'directionExcluded');
});
test('延伸方向排在首选、可接受之后', () => {
  const p = profile(); p.prefs.directions.extended = ['AI 应用开发'];
  const ext = coarseScore(p, job({ direction: 'AI 应用开发' }));
  const acc = coarseScore(p, job({ direction: '数据开发' }));
  assert.equal(ext.kind, 'extended');
  assert.ok(acc.score > ext.score);
});
test('延伸方向的岗位没有任何技能命中时，粗筛排除', () => {
  const p = profile(); p.prefs.directions.extended = ['AI 应用开发'];
  const r = runFunnel(p, [job({ id: '9', direction: 'AI 应用开发', jdText: '熟悉 LangChain' })], ctx, 20);
  assert.equal(r.selected.length, 0);
  assert.equal(r.coarseOut.length, 1);
});
test('漏斗：只取前 N 个，其余记为粗筛排除', () => {
  const jobs = Array.from({ length: 5 }, (_, i) => job({ id: String(i) }));
  const r = runFunnel(profile(), jobs, ctx, 3);
  assert.equal(r.selected.length, 3);
  assert.equal(r.coarseOut.length, 2);
});
