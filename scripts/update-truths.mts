// 按 src/simulator/key-requirements.ts 更新已有岗位的隐藏真相（只改 keyMust，不改 JD 正文，不调用大模型）。
// 同时更新 data/jobs/jobs.json 和数据库 job_truths；之后新的投递按新规则生成结果，已安排的结果不变。
// 用法：node --env-file=.env.local --import tsx scripts/update-truths.mts
import { readFile, writeFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { keyMustOf } from '../src/simulator/key-requirements.ts';
import type { SeedJob } from '../src/simulator/types.ts';

const jobs = JSON.parse(await readFile('data/jobs/jobs.json', 'utf8')) as SeedJob[];
let withKey = 0;
for (const j of jobs) {
  j.truth.keyMust = keyMustOf(j.direction, j.truth.writtenMust);
  if (j.truth.keyMust) withKey++;
}
await writeFile('data/jobs/jobs.json', JSON.stringify(jobs, null, 2), 'utf8');

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
});
let updated = 0;
for (const j of jobs) {
  const [r] = await db.query('UPDATE job_truths t JOIN jobs s ON s.id = t.job_id SET t.hidden = ? WHERE s.external_key = ?', [JSON.stringify(j.truth), j.key]);
  updated += (r as { affectedRows: number }).affectedRows;
}
await db.end();
const byDir: Record<string, string> = {};
for (const d of [...new Set(jobs.map(j => j.direction))]) {
  const list = jobs.filter(j => j.direction === d);
  byDir[d] = `${list.filter(j => j.truth.keyMust).length}/${list.length}`;
}
console.log(`共 ${jobs.length} 个岗位，${withKey} 个设有卡人项；数据库更新 ${updated} 条`);
console.log('各方向（有卡人项 / 总数）', byDir);
