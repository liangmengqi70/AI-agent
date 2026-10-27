// 代码边界检查：保证 Agent 看不到隐藏真相
// 规则：simulator/ 只能被 platform/mock/ 引用；其他目录（agent、services、domain、app 等）禁止引用。
// job_truths 和 sim_planned_events 两张表也只能在 simulator/ 和 scripts/ 中出现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await files(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative('src', p).replaceAll('\\', '/');

test('只有 platform/mock 可以引用 simulator', async () => {
  const bad: string[] = [];
  for (const f of await files('src')) {
    const r = rel(f);
    if (r.startsWith('simulator/') || r.startsWith('platform/mock/')) continue;
    if (/from ['"](@\/|\.\.?\/)+simulator/.test(await readFile(f, 'utf8'))) bad.push(r);
  }
  assert.deepEqual(bad, [], `这些文件不应引用 simulator：${bad.join(', ')}`);
});

test('隐藏真相相关的表只在模拟器中读取', async () => {
  const bad: string[] = [];
  for (const f of await files('src')) {
    const r = rel(f);
    if (r.startsWith('simulator/')) continue;
    if (/job_truths|sim_planned_events/.test(await readFile(f, 'utf8'))) bad.push(r);
  }
  assert.deepEqual(bad, [], `这些文件不应访问隐藏真相相关的表：${bad.join(', ')}`);
});
