// 对照实验：同一个人物分两组跑 3 轮——"Agent 组"采纳全部复盘建议，"固定策略组"全部不采纳。
// 两组的模拟器随机种子相同（同一岗位的运气相同），投递行为相同（推荐的全部投递），差异只来自策略。
// 前提：开发服务器已启动（npm run dev，端口 3001）。
// 用法：node --env-file=.env.local scripts/experiment.mjs [人物...]   例：node --env-file=.env.local scripts/experiment.mjs xiaozhou
// 结果从数据库统计（scripts/experiment-report.mjs），写入 data/experiments/latest.md
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildReport, renderReport } from './experiment-report.mjs';
import mysql from 'mysql2/promise';

const BASE = process.env.EXPERIMENT_BASE_URL || 'http://127.0.0.1:3001';
const ROUNDS = Number(process.env.EXPERIMENT_ROUNDS || 3);

/** 实验人物：简历 + 偏好（城市不限，保证每轮有足够的投递样本） */
const PERSONAS = {
  xiaozhou: { name: '小周（后端 / 数据开发）', file: 'data/personas/xiaozhou.pdf', prefs: { jobType: 'both', internKinds: ['daily', 'summer'], daysPerWeek: { usual: 4, max: 5 }, months: { usual: 6, max: 6 } } },
  xiaochen: { name: '小陈（产品经理）', file: 'data/personas/xiaochen.pdf', prefs: { jobType: 'intern', internKinds: ['daily', 'summer'], daysPerWeek: { usual: 4, max: 5 }, months: { usual: 3, max: 6 } } },
  xiaoxu: { name: '小许（新媒体 / 内容运营）', file: 'data/personas/xiaoxu.pdf', prefs: { jobType: 'intern', internKinds: ['daily', 'summer'], daysPerWeek: { usual: 4, max: 5 }, months: { usual: 3, max: 6 } } },
};

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, dateStrings: true,
});

/** 一个模拟访客：自己的 cookie，通过和网页相同的接口操作 */
function client() {
  let cookie = '';
  const req = async (path, init = {}) => {
    const res = await fetch(BASE + path, { ...init, headers: { ...(init.headers || {}), cookie } });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const body = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 409) throw new Error(`${path} ${res.status} ${body.error ?? ''}`);
    return body;
  };
  const post = (path, b = {}) => req(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const wait = async busy => { for (;;) { const r = await req('/api/rounds/current'); if (!busy.includes(r.round.status)) return r; await new Promise(x => setTimeout(x, 2500)); } };
  return { req, post, wait, cookie: () => cookie };
}

/** 设置共用的随机种子，并在 visitors.persona_key 记下组别（报告按它区分两组） */
async function markVisitor(cookie, seed, label) {
  const token = cookie.replace(/^ja_vid=/, '');
  const [v] = await db.query('SELECT id FROM visitors WHERE token_hash = ?', [createHash('sha256').update(token).digest('hex')]);
  await db.query('UPDATE sim_clocks SET seed = ? WHERE visitor_id = ?', [seed, v[0].id]);
  await db.query('UPDATE visitors SET persona_key = ? WHERE id = ?', [label, v[0].id]);
}
async function runArm(key, arm, log) {
  const p = PERSONAS[key];
  const c = client();
  const form = new FormData();
  form.append('file', new Blob([await readFile(p.file)], { type: 'application/pdf' }), `${key}.pdf`);
  await c.req('/api/resume', { method: 'POST', body: form });
  const pr = await c.req('/api/profile');
  Object.assign(pr.data.prefs, p.prefs);
  pr.data.prefs.cities.anyCity = true;
  await c.post('/api/profile/confirm', { version: pr.version, data: pr.data, sources: pr.sources, supplement: '' });
  await markVisitor(c.cookie(), `experiment:${key}`, `exp-${arm}-${key}`);

  for (let n = 1; n <= ROUNDS; n++) {
    const r = await c.wait(['generating']);
    if (r.round.status === 'failed') throw new Error(`第 ${n} 轮生成失败：${r.round.error}`);
    const rec = await c.req('/api/recommendations');
    if (!rec.items.length) { log(`${arm} 第 ${n} 轮没有推荐，提前结束`); break; }
    await c.post('/api/recommendations/decision', { jobIds: rec.items.map(i => i.jobId), decision: 'selected' });
    let ap = await c.post('/api/rounds/current/apply');
    if (ap.ok === false && ap.conflicts?.length) { // 和用户一样：取消有冲突的岗位后再确认
      await c.post('/api/recommendations/decision', { jobIds: ap.conflicts.map(x => x.jobId), decision: 'untouched' });
      ap = await c.post('/api/rounds/current/apply');
    }
    let started = false;
    for (let i = 0; i < 3 && !started; i++) started = (await c.post('/api/clock/advance', { days: 7 })).reviewStarted;
    await c.wait(['reviewing']);
    const review = await c.req('/api/reviews');
    const decision = arm === 'agent' ? 'accepted' : 'rejected';
    for (const pp of review.proposals) await c.post(`/api/reviews/proposals/${pp.id}`, { decision });
    log(`${arm} 第 ${n} 轮：推荐 ${rec.items.length}，投递 ${ap.applied}，建议 ${review.proposals.length} 条${review.proposals.length ? `（${review.proposals.map(x => x.title).join('；')}）` : ''}`);
    if (n < ROUNDS) await c.post('/api/reviews/current/finish');
  }


}

const keys = process.argv.slice(2).filter(k => PERSONAS[k]);
const targets = keys.length ? keys : Object.keys(PERSONAS);
async function writeReport() {
  const md = renderReport(await buildReport(db));
  await mkdir('data/experiments', { recursive: true });
  await writeFile('data/experiments/latest.md', md, 'utf8');
  return md;
}
try {
  for (const key of targets) {
    const log = msg => console.log(`[${key}] ${msg}`);
    log(`开始：${PERSONAS[key].name}`);
    await Promise.all([runArm(key, 'agent', log), runArm(key, 'fixed', log)]);
    await writeReport(); // 每完成一个人物就更新报告，中途失败也不丢结果
  }
} finally {
  console.log(`\n${await writeReport()}\n\n报告：data/experiments/latest.md`);
  await db.end();
}