import 'server-only';
// 推荐页上的用户操作：勾选 / 跳过、回答合并提问、确认投递；以及投递进度的读取
import { UserFacingError } from '@/lib/api';
import { applyChannel, jobSource, simClock } from '@/platform';
import { checkConstraints } from '@/domain/tiers';
import { addStep, currentRound, markApplied, setProfileVersion, type RoundRow } from '@/db/repos/rounds';
import { listDecisions, setDecision } from '@/db/repos/decisions';
import { answerQuestion as saveAnswer, listMatches, listQuestions } from '@/db/repos/matches';
import { createConfirmedVersion, getProfileRow, getProfileVersion } from '@/db/repos/profiles';
import { loadContext } from '@/agent/context';
import { assignTiers } from '@/agent/steps/assign-tiers';
import { arrange } from '@/agent/steps/arrange';

async function roundAwaitingApply(visitorId: string): Promise<RoundRow> {
  const round = await currentRound(visitorId);
  if (!round) throw new UserFacingError('还没有开始第 1 轮');
  if (round.status !== 'awaiting_apply') throw new UserFacingError('本轮已经确认投递，不能再修改选择', 409);
  return round;
}

/** 推荐页上展示的岗位（推荐 + 可以考虑） */
async function shownMatches(roundId: string) {
  return (await listMatches(roundId, 'analyzed')).filter(m => m.tier === 'rec' || m.tier === 'con');
}

/* ========== 勾选 / 跳过 ========== */
export async function decide(visitorId: string, input: { jobIds: string[]; decision: 'selected' | 'skipped' | 'untouched'; skipQuick?: string[]; skipNote?: string }) {
  const round = await roundAwaitingApply(visitorId);
  const shown = new Set((await shownMatches(round.id)).map(m => m.job_id));
  const ids = input.jobIds.filter(id => shown.has(id));
  if (!ids.length) throw new UserFacingError('找不到这个岗位，请刷新页面');
  const note = input.decision === 'skipped' ? (input.skipNote ?? '').trim().slice(0, 500) || null : null;
  const quick = input.decision === 'skipped' && input.skipQuick?.length ? input.skipQuick.slice(0, 5) : null;
  for (const id of ids) await setDecision(round.id, id, input.decision, quick, note);
  return { ok: true };
}

/* ========== 合并提问 ========== */
const Q_LABEL = { daysPerWeek: ['每周到岗', '天'], months: ['实习时长', '个月'] } as const;
type QKey = keyof typeof Q_LABEL;

/** 提问针对的数值：受影响岗位中最常见的要求（如"每周 4 天"） */
export function questionTarget(needs: number[]) {
  const freq = new Map<number, number>();
  needs.forEach(n => freq.set(n, (freq.get(n) ?? 0) + 1));
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
}

/** 推荐页上提问用的文字信息 */
export async function describeQuestions(round: RoundRow) {
  const qs = await listQuestions(round.id);
  if (!qs.length) return [];
  const ctx = await loadContext(round.id);
  const jobs = await ctx.jobs();
  const shown = new Set((await shownMatches(round.id)).map(m => m.job_id));
  return qs.map(q => {
    const key = q.constraint_key as QKey;
    const needs = q.affected_job_ids.map(id => checkConstraints(ctx.profile, jobs.get(id)!).find(c => c.key === key)?.need).filter((n): n is number => !!n);
    const pref = ctx.profile.prefs[key];
    return {
      id: q.id, key, answer: q.answer, target: questionTarget(needs), affected: q.affected_job_ids.length,
      shown: q.affected_job_ids.filter(id => shown.has(id)).length, usual: pref.usual, max: pref.max, label: Q_LABEL[key][0], unit: Q_LABEL[key][1],
    };
  });
}

/**
 * 回答合并提问：
 * - accept：把"通常"提高到目标值，生成新的画像版本，按新偏好重新判定档位（不调用大模型）
 * - reject：把"最多"降到目标值以下，要求达到目标值的岗位改判为不推荐
 * - keep_only：偏好不变，只记录回答
 */
export async function answerQuestion(visitorId: string, questionId: string, answer: 'accept' | 'reject' | 'keep_only') {
  const round = await roundAwaitingApply(visitorId);
  const desc = (await describeQuestions(round)).find(q => String(q.id) === String(questionId));
  if (!desc) throw new UserFacingError('找不到这个问题，请刷新页面');
  if (desc.answer) throw new UserFacingError('这个问题已经回答过了', 409);
  const target = desc.target;
  const before = new Map((await shownMatches(round.id)).map(m => [m.job_id, m.tier]));

  if (answer !== 'keep_only' && target) {
    const row = await getProfileRow(visitorId, round.profile_version);
    if (!row) throw new Error('找不到本轮使用的画像');
    const pref = row.data.prefs[desc.key];
    const usual = pref.usual ?? target;
    const next = answer === 'accept'
      ? { usual: Math.max(usual, target), max: Math.max(pref.max ?? target, target) }
      : { usual: Math.min(usual, target - 1), max: target - 1 }; // 能被提问说明 usual < target
    row.data.prefs[desc.key] = next;
    const version = await createConfirmedVersion(visitorId, row.data, { ...row.sources, [`prefs.${desc.key}`]: { source: 'user' } });
    await setProfileVersion(round.id, version);
    const ctx = await loadContext(round.id);
    await assignTiers(ctx);
    await arrange(ctx);
  }
  await saveAnswer(desc.id, answer);

  // 回答后升为"推荐"、且用户还没处理过的岗位，自动勾选
  const after = await shownMatches(round.id);
  const decisions = new Map((await listDecisions(round.id)).map(d => [d.job_id, d.decision]));
  let upgraded = 0, ticked = 0;
  for (const m of after) {
    if (m.tier === 'rec' && before.get(m.job_id) !== 'rec') {
      upgraded++;
      if ((decisions.get(m.job_id) ?? 'untouched') === 'untouched') { await setDecision(round.id, m.job_id, 'selected'); ticked++; }
    }
  }
  const removed = [...before.keys()].filter(id => !after.some(m => m.job_id === id)).length;
  const what = `${desc.label} ${target} ${desc.unit}`;
  const message = answer === 'accept'
    ? `已更新偏好：通常${what}。${upgraded ? `${upgraded} 个岗位升为"推荐"${ticked ? `，其中 ${ticked} 个已自动勾选` : ''}。` : ''}之后会多推荐这类岗位。`
    : answer === 'reject'
      ? `好的，要求${what}及以上的岗位不再推荐${removed ? `，本轮 ${removed} 个已移除` : ''}。`
      : '好的，保留这些岗位，偏好不变。';
  await addStep(round.id, 'question_answer', 'user', '回答合并提问', `${what}：${answer === 'accept' ? '可以' : answer === 'reject' ? '不行' : '只看本轮这些'}`, message);
  return { message };
}

/* ========== 确认投递 ========== */
export type ApplyConflict = { jobId: string; title: string; company: string; reason: string };

export async function confirmApply(visitorId: string, settings: { roundApplyLimit: number; sameCompanyLimit: number }) {
  const round = await roundAwaitingApply(visitorId);
  const { date } = await simClock.current(visitorId);
  const shown = new Map((await shownMatches(round.id)).map(m => [m.job_id, m]));
  const decisions = await listDecisions(round.id);
  const picked = decisions.filter(d => d.decision === 'selected' && shown.has(d.job_id)).map(d => d.job_id);
  if (!picked.length) throw new UserFacingError('还没有勾选要投递的岗位');

  const jobs = new Map((await jobSource.listReleased(date)).map(j => [j.id, j]));
  const existing = new Set((await applyChannel.list(visitorId)).map(a => a.jobId));
  const byCompany = await applyChannel.countByCompany(visitorId);
  const conflicts: ApplyConflict[] = [];
  const counted = new Map(byCompany);
  for (const id of picked) {
    const j = jobs.get(id);
    const base = { jobId: id, title: j?.title ?? '', company: j?.company ?? '' };
    if (!j) { conflicts.push({ ...base, reason: '岗位已下线' }); continue; }
    if (existing.has(id)) { conflicts.push({ ...base, reason: '之前已经投递过' }); continue; }
    if (j.deadlineSim && j.deadlineSim < date) { conflicts.push({ ...base, reason: '已过截止日期' }); continue; }
    const n = (counted.get(j.company) ?? 0) + 1;
    if (n > settings.sameCompanyLimit) { conflicts.push({ ...base, reason: `同一家公司本季最多投 ${settings.sameCompanyLimit} 个` }); continue; }
    counted.set(j.company, n);
  }
  if (picked.length > settings.roundApplyLimit) {
    return { ok: false as const, conflicts, message: `每轮最多投递 ${settings.roundApplyLimit} 个，你勾选了 ${picked.length} 个` };
  }
  if (conflicts.length) return { ok: false as const, conflicts, message: `有 ${conflicts.length} 个岗位不能投递，取消勾选后再确认` };

  if (!(await markApplied(round.id, date))) throw new UserFacingError('本轮已经确认投递过了', 409);
  const items = picked.map(id => ({ jobId: id, tier: shown.get(id)!.tier as 'rec' | 'con' }));
  const candidate = await getProfileVersion(visitorId, round.profile_version); // 投出去的"简历"就是本轮使用的画像
  const n = await applyChannel.submit(visitorId, round.id, items, date, candidate!);
  const skipped = decisions.filter(d => d.decision === 'skipped' && shown.has(d.job_id));
  const untouched = shown.size - picked.length - skipped.length;
  const rec = items.filter(i => i.tier === 'rec').length;
  const notes = skipped.map(d => d.skip_note).filter(Boolean);
  await addStep(round.id, 'apply', 'user', '确认投递', `投递 ${n} 个，跳过 ${skipped.length} 个${untouched ? `，未处理 ${untouched} 个` : ''}`,
    `推荐 ${rec} 个、可以考虑 ${n - rec} 个。${notes.length ? `跳过说明：${notes.join('；')}` : ''}`);
  return { ok: true as const, applied: n };
}

/* ========== 投递进度 ========== */
export async function listApplications(visitorId: string) {
  const apps = await applyChannel.list(visitorId);
  const { date } = await simClock.current(visitorId);
  const jobs = new Map((await jobSource.listReleased(date)).map(j => [j.id, j]));
  // 推荐时的逐条判断（按投递所在轮次读取），用于详情抽屉中的"当时的推荐依据"
  const matches = new Map<string, Awaited<ReturnType<typeof listMatches>>[number]>();
  for (const roundId of new Set(apps.map(a => a.roundId))) {
    for (const m of await listMatches(roundId)) matches.set(`${roundId}:${m.job_id}`, m);
  }
  return {
    simDate: date,
    items: apps.map(a => {
      const j = jobs.get(a.jobId);
      const m = matches.get(`${a.roundId}:${a.jobId}`);
      return {
        ...a, title: j?.title ?? '', company: j?.company ?? '', city: j?.city ?? '', jobType: j?.jobType ?? '', isNew: a.events.some(e => !e.seen),
        salary: j ? { min: j.salaryMin, max: j.salaryMax, unit: j.salaryUnit } : null, jd: j?.jdText ?? '',
        reason: m?.reason ?? null, judgments: m?.judgments ?? [],
      };
    }),
  };
}

export async function markApplicationSeen(visitorId: string, applicationId: string) {
  await applyChannel.markSeen(visitorId, applicationId);
}
