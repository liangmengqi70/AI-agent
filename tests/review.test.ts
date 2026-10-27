// 复盘规则测试：复盘时机、投递阶段判断、分组统计、护栏
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewDue, stageOf, computeStats, stripInternalIds, type ReviewApp } from '../src/domain/review';
import { applyChanges, checkProposal, describeChange, type ChangeSpec } from '../src/domain/guardrails';
import { DEFAULT_STRATEGY_PARAMS } from '../src/domain/config';
import { emptyProfile } from '../src/domain/profile';

const due = (applied: number, withResult: number, days: number) =>
  reviewDue({ applied, withResult, appliedSim: '2026-03-03', simDate: new Date(Date.UTC(2026, 2, 3 + days)).toISOString().slice(0, 10) });

test('复盘时机：5 个结果 + 60% 或满 7 天；满 10 天强制', () => {
  assert.equal(due(8, 5, 3), true);    // 5/8 = 62%
  assert.equal(due(15, 5, 3), false);  // 只有 33%，也没满 7 天
  assert.equal(due(15, 5, 7), true);   // 满 7 天
  assert.equal(due(15, 4, 9), false);  // 不到 5 个结果
  assert.equal(due(15, 0, 10), true);  // 满 10 天强制
});

const app = (over: Partial<ReviewApp>, events: string[]): ReviewApp => ({
  id: '1', roundNo: 1, jobId: 'j', tier: 'rec', status: 'waiting', appliedSim: '2026-03-03', title: 't', company: 'c',
  city: '北京', direction: '后端开发', companyType: 'mid', jobType: 'daily_intern',
  events: ['applied', ...events].map(type => ({ type, simDate: '2026-03-05', message: null })), ...over,
});

test('投递阶段：按事件判断走到了哪一步', () => {
  assert.equal(stageOf(app({}, [])), 'pending');
  assert.equal(stageOf(app({}, ['rejected'])), 'resume_reject');
  assert.equal(stageOf(app({}, ['exam_notice', 'rejected'])), 'exam_fail');
  assert.equal(stageOf(app({}, ['interview'])), 'interview');
  assert.equal(stageOf(app({}, ['exam_notice', 'interview', 'offer'])), 'offer');
  assert.equal(stageOf(app({}, ['no_response'])), 'no_response');
});

test('去掉文字中的内部投递编号', () => {
  assert.equal(stripInternalIds('1 个面试未过（投递编号 352）的拒信提到 MySQL'), '1 个面试未过的拒信提到 MySQL');
  assert.equal(stripInternalIds('投递编号 12、15 都被拒'), '都被拒');
});

test('分组统计：按方向统计投递数和简历通过数', () => {
  const s = computeStats([
    app({ direction: '后端开发' }, ['interview']), app({ direction: '后端开发' }, ['rejected']),
    app({ direction: '数据开发', tier: 'con' }, ['rejected']), app({ direction: '数据开发', tier: 'con' }, []),
  ]);
  assert.equal(s.applied, 4); assert.equal(s.withResult, 3); assert.equal(s.pending, 1); assert.equal(s.resumePass, 1);
  assert.equal(s.interviewPending, 1); assert.equal(s.interviewFail, 0);
  const data = s.groups.direction.find(g => g.key === '数据开发')!;
  assert.deepEqual([data.n, data.resumePass, data.resumeReject, data.pending], [2, 0, 1, 1]);
  assert.equal(s.groups.tier.find(g => g.key === '可以考虑')!.n, 2);
});

function guard(spec: ChangeSpec, over: { samples?: number; consistent?: number; prev?: typeof DEFAULT_STRATEGY_PARAMS; params?: typeof DEFAULT_STRATEGY_PARAMS } = {}) {
  const profile = emptyProfile();
  profile.skills = ['Java', 'MySQL'];
  profile.prefs.cities.preferred = ['北京']; profile.prefs.cities.acceptable = ['杭州'];
  profile.prefs.directions = { preferred: ['后端开发'], acceptable: ['数据开发'], extended: ['AI 应用开发'], excluded: [] };
  return checkProposal({ spec, params: over.params ?? structuredClone(DEFAULT_STRATEGY_PARAMS), profile, prevParams: over.prev ?? null, lastAccepted: [], samples: over.samples ?? 6, consistent: over.consistent ?? 3 });
}

test('护栏：降级规则——证据充足给出依据；已具备的技能拒绝', () => {
  const ok = guard({ type: 'add_downgrade', keyword: 'Spark' });
  assert.equal(ok.verdict, 'ok');
  if (ok.verdict === 'ok') { assert.equal(ok.kind, 'rule'); assert.equal(ok.basisLabel, '依据：6 个投递 · 3 封拒信说法一致'); }
  assert.equal(guard({ type: 'add_downgrade', keyword: 'Java' }).verdict, 'reject');
  const strong = guard({ type: 'add_downgrade', keyword: 'Hive' }, { samples: 4, consistent: 3 }); // 样本少但 3 封拒信说法一致
  assert.ok(strong.verdict === 'ok' && !strong.weak && strong.basisLabel === '依据：4 个投递 · 3 封拒信说法一致');
  const weak = guard({ type: 'add_downgrade', keyword: 'Hive' }, { samples: 3, consistent: 2 });
  assert.ok(weak.verdict === 'ok' && weak.weak && weak.basisLabel === '依据不足，仅供参考');
});

test('护栏：探索比例一次最多 ±10%，且不低于下限 10%', () => {
  const r = guard({ type: 'set_explore_ratio', value: 0.05 });
  assert.ok(r.verdict === 'ok' && r.spec.type === 'set_explore_ratio' && r.spec.value === 0.1);
  const big = guard({ type: 'set_explore_ratio', value: 0.45 });
  assert.ok(big.verdict === 'ok' && big.spec.type === 'set_explore_ratio' && big.spec.value === 0.3);
  const atMin = { ...structuredClone(DEFAULT_STRATEGY_PARAMS), exploreRatio: 0.1 };
  assert.equal(guard({ type: 'set_explore_ratio', value: 0.05 }, { params: atMin }).verdict, 'reject');
});

test('护栏：上一轮刚调过的参数不能马上往回调', () => {
  const now = { ...structuredClone(DEFAULT_STRATEGY_PARAMS), exploreRatio: 0.1 };
  const prev = { ...structuredClone(DEFAULT_STRATEGY_PARAMS), exploreRatio: 0.2 };
  assert.equal(guard({ type: 'set_explore_ratio', value: 0.2 }, { params: now, prev }).verdict, 'reject');
});

test('护栏：涉及偏好的只能建议；不在偏好里的城市拒绝', () => {
  const r = guard({ type: 'remove_city', city: '杭州' });
  assert.ok(r.verdict === 'ok' && r.kind === 'preference' && r.basisLabel === '需要你决定');
  assert.equal(guard({ type: 'remove_city', city: '成都' }).verdict, 'reject');
  assert.equal(guard({ type: 'promote_direction', direction: '后端开发' }).verdict, 'reject');
});

test('执行调整：规则改策略，偏好改画像', () => {
  const profile = emptyProfile();
  profile.prefs.cities.acceptable = ['杭州'];
  const r = applyChanges(DEFAULT_STRATEGY_PARAMS, profile, [{ type: 'add_downgrade', keyword: 'Spark' }, { type: 'remove_city', city: '杭州' }], 1);
  assert.deepEqual(r.params.downgradeRules, [{ keyword: 'Spark', fromRound: 1 }]);
  assert.deepEqual(r.profile.prefs.cities.acceptable, []);
  assert.ok(r.profile.prefs.cities.excluded.includes('杭州'));
  assert.deepEqual(DEFAULT_STRATEGY_PARAMS.downgradeRules, []); // 不修改原对象
  assert.equal(describeChange({ type: 'set_explore_ratio', value: 0.1 }, DEFAULT_STRATEGY_PARAMS), '探索比例 20% → 10%');
});
