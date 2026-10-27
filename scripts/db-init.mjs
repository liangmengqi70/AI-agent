// 数据库初始化：创建 jobagent 库（如不存在），按编号执行 migrations/ 中尚未执行的 SQL 文件。
// 用法：npm run db:init（从 .env.local 读取连接信息）
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const database = process.env.MYSQL_DATABASE || 'jobagent';
if (!/^[a-z0-9_]+$/i.test(database)) throw new Error(`数据库名不合法：${database}`);
if (!process.env.MYSQL_USER) {
  console.error('缺少 MYSQL_USER，请先在 .env.local 中填写数据库连接信息（可参考 .env.example）。');
  process.exit(1);
}

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  multipleStatements: true,
});

try {
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await connection.query(`USE \`${database}\``);
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(100) PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) COMMENT='已执行的迁移文件'`);

  const [done] = await connection.query('SELECT name FROM schema_migrations');
  const applied = new Set(done.map(row => row.name));
  const dir = path.resolve('migrations');
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) { console.log(`已执行过：${file}`); continue; }
    const sql = await readFile(path.join(dir, file), 'utf8');
    await connection.query(sql);
    await connection.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
    console.log(`执行完成：${file}`);
  }

  const [tables] = await connection.query(
    'SELECT table_name AS name, table_comment AS comment FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name',
    [database],
  );
  console.log(`\n数据库 ${database} 中共有 ${tables.length} 张表：`);
  for (const t of tables) console.log(`  ${t.name.padEnd(26)} ${t.comment}`);
} finally {
  await connection.end();
}
