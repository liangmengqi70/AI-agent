// 开发用：把指定访客最近一次复盘的轮次退回"跟踪中"，再推进 1 天即可重新触发复盘（调整复盘提示词时使用）
// 用法：node --env-file=.env.local scripts/dev-rerun-review.mjs <ja_vid 的值>
import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
const vid = process.argv[2].replace(/^ja_vid=/, '');
const c = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
const [v] = await c.query('SELECT id FROM visitors WHERE token_hash = ?', [createHash('sha256').update(vid).digest('hex')]);
if (!v.length) { console.log('找不到访客'); process.exit(1); }
const [r] = await c.query("UPDATE rounds SET status = 'tracking' WHERE visitor_id = ? AND status = 'awaiting_review_decision' ORDER BY round_no DESC LIMIT 1", [v[0].id]);
console.log('已退回', r.affectedRows);
await c.end();
