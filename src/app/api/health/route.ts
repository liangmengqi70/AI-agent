import { db } from '@/db/pool';

// 健康检查：确认服务和数据库是否正常
export async function GET() {
  try {
    const [rows] = await db().query('SELECT COUNT(*) AS tables FROM information_schema.tables WHERE table_schema = DATABASE()');
    const tables = Number((rows as Array<{ tables: number }>)[0]?.tables ?? 0);
    return Response.json({ ok: true, database: process.env.MYSQL_DATABASE, tables });
  } catch (error) {
    console.error('健康检查失败', error); // 详细原因只写日志，不返回给访问者
    return Response.json({ ok: false, error: '数据库连接失败' }, { status: 503 });
  }
}
