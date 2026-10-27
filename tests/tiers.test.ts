// 档位判定、约束检查、探索名额的单元测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignTier, checkConstraints, exploreCount, type Judgment, type ConstraintCheck } from '../src/domain/tiers';
import { DEFAULT_STRATEGY_PARAMS as P } from '../src/domain/config';
import { emptyProfile } from '../src/domain/profile';
import type { PublicJob } from '../src/domain/job';

const j = (kind: 'must' | 'bonus', status: Judgment['status'], req = '要求'): Judgment => ({ req, kind, status, evidence: '' });
const none: ConstraintCheck[] = [];

test('必须项全部满足、加分项过半 → 推荐', () => {
  assert.equal(assignTier([j('must', 'ok'), j('must', 'ok'), j('bonus', 'ok'), j('bonus', 'no')], none, 'preferred', P).tier, 'rec');
});
test('允许 1 项必须项部分满足', () => {
  assert.equal(assignTier([j('must', 'ok'), j('must', 'part'), j('bonus', 'ok')], none, 'preferred', P).tier, 'rec');
});
test('2 项必须项部分满足 → 可以考虑', () => {
  assert.equal(assignTier([j('must', 'part'), j('must', 'part'), j('bonus', 'ok')], none, 'preferred', P).tier, 'con');
});
test('加分项满足不到一半 → 可以考虑', () => {
  assert.equal(assignTier([j('must', 'ok'), j('bonus', 'no'), j('bonus', 'no'), j('bonus', 'ok')], none, 'preferred', P).tier, 'con');
});
test('只差 1 项必须项 → 可以考虑，并标注', () => {
  const r = assignTier([j('must', 'ok'), j('must', 'no', '熟悉 Flink'), j('bonus', 'ok')], none, 'preferred', P);
  assert.equal(r.tier, 'con');
  assert.ok(r.flags.includes('有 1 项必须项不满足'));
});
test('2 项必须项不满足 → 不推荐，并写明哪几项', () => {
  const r = assignTier([j('must', 'no', '熟悉 Kafka'), j('must', 'no', '熟悉 Flink')], none, 'preferred', P);
  assert.equal(r.tier, 'no');
  assert.match(r.why, /Flink/);
});
test('复盘新增的降档规则生效', () => {
  const params = { ...P, downgradeRules: [{ keyword: 'Spark', fromRound: 1 }] };
  assert.equal(assignTier([j('must', 'part', '熟悉 Spark 或 Hive'), j('bonus', 'ok')], none, 'preferred', params).tier, 'no');
});
test('延伸方向最高只能是可以考虑', () => {
  const r = assignTier([j('must', 'ok'), j('bonus', 'ok')], none, 'extended', P);
  assert.equal(r.tier, 'con');
  assert.ok(r.flags.includes('延伸方向'));
});
test('到岗天数在可调整范围内 → 可以考虑；超出 → 不推荐', () => {
  const within: ConstraintCheck[] = [{ key: 'daysPerWeek', level: 'within', need: 4, usual: 3, max: 4 }];
  const over: ConstraintCheck[] = [{ key: 'daysPerWeek', level: 'over', need: 5, usual: 3, max: 4 }];
  assert.equal(assignTier([j('must', 'ok')], within, 'preferred', P).tier, 'con');
  assert.equal(assignTier([j('must', 'ok')], over, 'preferred', P).tier, 'no');
});
test('约束检查：通常 3 天、最多 4 天', () => {
  const p = emptyProfile(); p.prefs.daysPerWeek = { usual: 3, max: 4 }; p.prefs.months = { usual: 3, max: 6 };
  const job = { jobType: 'daily_intern', daysPerWeek: 5, months: 4 } as PublicJob;
  const c = checkConstraints(p, job);
  assert.equal(c.find(x => x.key === 'daysPerWeek')?.level, 'over');
  assert.equal(c.find(x => x.key === 'months')?.level, 'within');
});
test('校招岗位不检查到岗天数', () => {
  const p = emptyProfile(); p.prefs.daysPerWeek = { usual: 3, max: 4 };
  assert.equal(checkConstraints(p, { jobType: 'campus', daysPerWeek: 5, months: null } as PublicJob).length, 0);
});
test('探索名额：10 个推荐、20% → 预选 3 个；没有可以考虑时为 0', () => {
  assert.equal(exploreCount(10, 8, 0.2), 3);
  assert.equal(exploreCount(10, 0, 0.2), 0);
  assert.equal(exploreCount(0, 5, 0.2), 1);
});
