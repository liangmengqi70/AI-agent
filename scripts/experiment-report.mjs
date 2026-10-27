// 对照实验报告：从数据库读取实验访客的数据生成报告（实验中途失败也能用已完成的部分重新生成）。
// 每轮统计"投递满 7 天时"已经发生的事件（按事件的模拟日期计算），两组在同一时间点比较。
// 用法：node --env-file=.env.local scripts/experiment-report.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

export const PERSONA_NAMES = { xiaozhou: '小周（后端 / 数据开发）', xiaochen: '小陈（产品经理）', xiaoxu: '小许（新媒体 / 内容运营）' };
const DAYS = 7;
const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

export async function buildReport(db) {
  // 实验访客：sim_clocks.seed = experiment:<人物>；组别记在 visitors.persona_key（exp-agent-xx / exp-fixed-xx）
  const [visitors] = await db.query(
    `SELECT v.id, v.persona_key, c.seed FROM visitors v JOIN sim_clocks c ON c.visitor_id = v.id WHERE c.seed LIKE 'experiment:%' ORDER BY v.id`);
  const groups = {};
  for (const v of visitors) {
    const key = v.seed.slice('experiment:'.length);
    let arm = v.persona_key?.startsWith('exp-agent') ? 'agent' : v.persona_key?.startsWith('exp-fixed') ? 'fixed' : null;
    if (!arm) { // 早期没有标记组别的访客：有"不采纳"的是固定组，有"采纳"的是 Agent 组
      const [d] = await db.query(`SELECT p.decision, COUNT(*) n FROM review_proposals p JOIN reviews r ON r.id = p.review_id JOIN rounds o ON o.id = r.round_id WHERE o.visitor_id = ? GROUP BY p.decision`, [v.id]);
      arm = d.some(x => x.decision === 'rejected') ? 'fixed' : d.some(x => x.decision === 'accepted') ? 'agent' : 'unknown';
    }
    (groups[key] ??= {})[arm] = v.id; // 同一人物同一组有多次时取最新一次
  }

  const results = {};
  for (const [key, arms] of Object.entries(groups)) {
    if (arms.unknown && !arms.agent) arms.agent = arms.unknown;
    else if (arms.unknown && !arms.fixed) arms.fixed = arms.unknown;
    if (!arms.agent || !arms.fixed) continue;
    results[key] = {};
    for (const arm of ['agent', 'fixed']) {
      const [rounds] = await db.query('SELECT id, round_no, strategy_version, applied_sim FROM rounds WHERE visitor_id = ? AND applied_sim IS NOT NULL ORDER BY round_no', [arms[arm]]);
      const out = [];
      for (const r of rounds) {
        const [shown] = await db.query("SELECT COUNT(*) n FROM matches WHERE round_id = ? AND tier IN ('rec','con')", [r.id]);
        const [apps] = await db.query('SELECT id FROM applications WHERE round_id = ?', [r.id]);
        const cutoff = addDays(String(r.applied_sim).slice(0, 10), DAYS);
        const [evs] = apps.length ? await db.query('SELECT application_id, type FROM application_events WHERE application_id IN (?) AND sim_date <= ?', [apps.map(a => a.id), cutoff]) : [[]];
        const has = (id, types) => evs.some(e => e.application_id === id && types.includes(e.type));
        const [props] = await db.query(
          `SELECT p.title, p.basis_label, p.decision FROM review_proposals p JOIN reviews v ON v.id = p.review_id WHERE v.round_id = ? ORDER BY p.seq`, [r.id]);
        out.push({
          no: r.round_no, strategy: r.strategy_version, recommended: Number(shown[0].n), applied: apps.length,
          resolved: apps.filter(a => has(a.id, ['exam_notice', 'interview', 'offer', 'rejected'])).length,
          resumePass: apps.filter(a => has(a.id, ['exam_notice', 'interview', 'offer'])).length,
          interview: apps.filter(a => has(a.id, ['interview', 'offer'])).length,
          offer: apps.filter(a => has(a.id, ['offer'])).length,
          proposals: props.map(p => ({ title: p.title, basis: p.basis_label, decision: p.decision })),
        });
      }
      results[key][arm] = out;
    }
  }
  return results;
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);

export function renderReport(results) {
  const lines = ['# 对照实验结果', '',
    '- **Agent 组**：每轮复盘后采纳全部建议；**固定策略组**：全部不采纳，始终使用策略 v1；',
    '- 两组共用同一个模拟器随机种子（同一岗位的结果相同），都投递推荐页上的全部岗位；',
    `- 每轮统计投递满 ${DAYS} 天时的结果：邀请率 = 收到笔试或面试邀请 / 已回复，面试率 = 收到面试 / 投递数。`, ''];
  for (const [key, { agent, fixed }] of Object.entries(results)) {
    lines.push(`## ${PERSONA_NAMES[key] ?? key}`, '', '| 轮次 | 组 | 策略 | 推荐 | 投递 | 已回复 | 邀请率 | 面试率 | Offer |', '|---|---|---|---|---|---|---|---|---|');
    for (let i = 0; i < Math.max(agent.length, fixed.length); i++) {
      for (const [name, arm] of [['Agent', agent], ['固定', fixed]]) {
        const r = arm[i]; if (!r) continue;
        lines.push(`| ${r.no} | ${name} | v${r.strategy} | ${r.recommended} | ${r.applied} | ${r.resolved} | ${pct(r.resumePass, r.resolved)} | ${pct(r.interview, r.applied)} | ${r.offer} |`);
      }
    }
    // 从第 2 轮开始两组的策略才可能不同
    const later = arr => arr.filter(r => r.no >= 2);
    const [a, f] = [later(agent), later(fixed)];
    lines.push('', `**第 2 轮起合计**：Agent 组投递 ${sum(a, 'applied')} 个，邀请率 ${pct(sum(a, 'resumePass'), sum(a, 'resolved'))}，面试 ${sum(a, 'interview')} 个；` +
      `固定组投递 ${sum(f, 'applied')} 个，邀请率 ${pct(sum(f, 'resumePass'), sum(f, 'resolved'))}，面试 ${sum(f, 'interview')} 个。`, '');
    const accepted = agent.flatMap(r => r.proposals.filter(p => p.decision === 'accepted').map(p => `第 ${r.no} 轮：${p.title}（${p.basis}）`));
    lines.push(`Agent 组采纳的调整：${accepted.length ? '' : '无'}`, ...accepted.map(x => `- ${x}`), '');
  }
  return lines.join('\n');
}

// 直接运行时：生成报告
if (import.meta.url === `file:///${process.argv[1].replaceAll('\\', '/')}` || process.argv[1]?.endsWith('experiment-report.mjs')) {
  const db = await mysql.createConnection({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, dateStrings: true,
  });
  const results = await buildReport(db);
  await db.end();
  const md = renderReport(results);
  await mkdir('data/experiments', { recursive: true });
  await writeFile('data/experiments/latest.md', md, 'utf8');
  await writeFile('data/experiments/latest.json', JSON.stringify(results, null, 2), 'utf8');
  console.log(md);
}
