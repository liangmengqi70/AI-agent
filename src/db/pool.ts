import 'server-only';
import mysql, { type Pool, type PoolConnection } from 'mysql2/promise';

// 开发时热更新会重复加载模块，把连接池挂在全局对象上，避免重复创建
const shared = globalThis as unknown as { jobagentPool?: Pool };

export function db(): Pool {
  const database = process.env.MYSQL_DATABASE;
  const user = process.env.MYSQL_USER;
  if (!database || !user) throw new Error('数据库尚未配置：请在 .env.local 中填写 MYSQL_DATABASE 和 MYSQL_USER');
  return shared.jobagentPool ??= mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    database,
    user,
    password: process.env.MYSQL_PASSWORD,
    connectionLimit: 5,
    supportBigNumbers: true,
    bigNumberStrings: true,
    timezone: '+08:00',
    dateStrings: true,
  });
}

/** 在一个事务中执行：全部成功才提交，出错自动回滚 */
export async function transaction<T>(fn: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
