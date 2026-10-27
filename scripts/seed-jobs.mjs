// 把 data/jobs/jobs.json 导入数据库（jobs 公开信息 + job_truths 隐藏真相）。
// 默认只追加数据库里还没有的岗位（按编号），已有岗位和投递数据保持不变。
// 用法：npm run jobs:seed            追加新岗位
//       npm run jobs:seed -- --reset 清空全部岗位（以及依赖岗位的投递、匹配数据）后重新导入，只在开发阶段使用
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

const reset = process.argv.includes('--reset');
const all = JSON.parse(await readFile('data/jobs/jobs.json', 'utf8'));
const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
});
try {
  await c.beginTransaction();
  if (reset) {
    for (const t of ['application_events', 'sim_planned_events', 'applications', 'matches', 'job_parses', 'job_truths', 'jobs']) {
      await c.query(`DELETE FROM ${t}`);
    }
  }
  const [rows] = await c.query('SELECT external_key FROM jobs');
  const have = new Set(rows.map(r => r.external_key));
  const jobs = all.filter(j => !have.has(j.key));
  for (const j of jobs) {
    const [r] = await c.query(
      `INSERT INTO jobs (external_key, company, company_type, title, direction, city, job_type, salary_min, salary_max, salary_unit,
        days_per_week, months, grad_year, degree, deadline_sim, released_sim, jd_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [j.key, j.company, j.companyType, j.title, j.direction, j.city, j.jobType, j.salaryMin, j.salaryMax, j.salaryUnit,
        j.daysPerWeek, j.months, j.gradYear, j.degree, j.deadlineSim, j.releasedSim, j.jdText],
    );
    await c.query('INSERT INTO job_truths (job_id, hidden) VALUES (?, ?)', [r.insertId, JSON.stringify(j.truth)]);
  }
  await c.commit();
  console.log(`已导入 ${jobs.length} 个新岗位（数据库中共 ${have.size + jobs.length} 个）`);
} catch (e) {
  await c.rollback();
  throw e;
} finally {
  await c.end();
}
