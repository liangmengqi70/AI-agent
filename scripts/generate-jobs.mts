// 生成模拟岗位：岗位属性和隐藏真相由程序按配额随机生成（固定随机种子，可复现），
// JD 正文由大模型按属性撰写（失败时用模板兜底）。结果写入 data/jobs/jobs.json。
// 用法：npm run jobs:generate        （之后用 npm run jobs:seed 导入数据库）
//       APPEND=1 npm run jobs:generate  追加一批（按 DIRS 中的 extra 数量），已有岗位保持不变
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { HiddenTruth, SeedJob } from '../src/simulator/types.ts';
import { keyMustOf } from '../src/simulator/key-requirements.ts';

// 每个方向的数量见下方 DIRS；JOB_COUNT 可整体缩放（不设置则按 DIRS 原数量生成）
const TOTAL = Number(process.env.JOB_COUNT || 0);
const APPEND = process.env.APPEND === '1';
const SEED = APPEND ? 20260415 : 20260303;

/* ---------- 固定种子的随机数 ---------- */
let state = SEED;
const rand = () => { state |= 0; state = (state + 0x6D2B79F5) | 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
const between = (a: number, b: number) => a + rand() * (b - a);
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
function weighted<T>(pairs: Array<[T, number]>): T { let r = rand() * pairs.reduce((s, p) => s + p[1], 0); for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; } return pairs[0][0]; }
const sample = <T,>(arr: readonly T[], n: number) => [...arr].sort(() => rand() - 0.5).slice(0, n);

/* ---------- 方向配置：数量、岗位名、要求池 ---------- */
const DIRS = [
  { dir: '后端开发', n: 18, extra: 40, intern: ['后端开发实习生', 'Java 开发实习生', 'Go 开发实习生'], campus: ['后端开发工程师（校招）'],
    must: ['熟悉 Java 或 Go 语言', '掌握 MySQL 等关系型数据库', '扎实的计算机网络基础', '良好的数据结构与算法基础'], bonus: ['有 Redis 使用经验', '熟悉 Spring Boot', '熟悉 Linux 常用命令', '了解 Docker', '了解微服务架构', '有 Kafka 等消息队列经验', '有后端实习经历'] },
  { dir: '数据开发', n: 12, extra: 30, intern: ['数据开发实习生', '大数据开发实习生', '数据仓库实习生'], campus: ['数据开发工程师（校招）'],
    must: ['熟练使用 SQL', '掌握 Python 或 Java', '熟悉 Spark 或 Hive', '了解数据仓库分层设计'], bonus: ['有 Flink 实时计算经验', '有数据可视化经验', '熟悉 Hadoop 生态', '有数据相关实习经历'] },
  { dir: '前端开发', n: 8, extra: 20, intern: ['前端开发实习生'], campus: ['前端开发工程师（校招）'],
    must: ['熟悉 HTML、CSS、JavaScript', '熟悉 React 或 Vue', '了解浏览器渲染原理'], bonus: ['熟悉 TypeScript', '有小程序开发经验', '了解前端工程化（Webpack / Vite）', '有个人作品或开源项目'] },
  { dir: '算法', n: 20, extra: 15, intern: ['算法实习生', 'NLP 算法实习生', '大模型算法实习生', '推荐算法实习生', '计算机视觉算法实习生'], campus: ['算法工程师（校招）', 'NLP 算法工程师（校招）'],
    must: ['扎实的机器学习基础', '熟练使用 Python', '熟悉 PyTorch 或 TensorFlow', '了解 Transformer 等深度学习模型'], bonus: ['有论文发表', '有 Kaggle 等竞赛获奖', '有大模型微调经验', '有 NLP 或推荐项目经验', '熟悉 Hugging Face Transformers'] },
  { dir: 'AI 应用开发', n: 10, extra: 20, intern: ['大模型应用开发实习生', 'AI Agent 开发实习生'], campus: ['AI 应用开发工程师（校招）'],
    must: ['熟练使用 Python', '了解大模型 API 调用和 Prompt 设计', '具备基本的后端开发能力'], bonus: ['有 RAG 或 Agent 项目经验', '熟悉 LangChain 等框架', '了解向量数据库', '有前端开发经验'] },
  { dir: '测试开发', n: 6, extra: 15, intern: ['测试开发实习生'], campus: ['测试开发工程师（校招）'],
    must: ['掌握 Python 或 Java', '了解软件测试方法', '熟悉 Linux 常用命令'], bonus: ['有自动化测试经验', '了解性能测试工具', '有测试相关实习'] },
  { dir: '产品经理', n: 35, extra: 40, intern: ['产品经理实习生', '产品助理实习生'], campus: ['产品经理（校招）', '管培生 · 产品方向（校招）'],
    must: ['较强的逻辑思维和沟通能力', '能独立完成需求文档和原型', '对互联网产品有自己的理解'], bonus: ['有产品相关实习经历', '会使用 Axure 或 Figma', '会 SQL，能做数据分析', '有完整的校园项目或作品'] },
  { dir: 'AI 产品经理', n: 20, extra: 15, intern: ['AI 产品经理实习生'], campus: ['AI 产品经理（校招）'],
    must: ['了解大模型基本原理和应用场景', '能独立完成需求文档和原型', '较强的逻辑思维能力'], bonus: ['有 AI 产品或 Agent 相关项目', '有产品实习经历', '有技术背景或会写代码', '会做数据分析'] },
  { dir: '产品运营', n: 18, extra: 30, intern: ['产品运营实习生'], campus: ['产品运营专员（校招）'],
    must: ['较强的数据分析能力', '良好的沟通协调能力', '熟练使用 Excel'], bonus: ['会 SQL', '有运营相关实习', '有活动策划经验'] },
  { dir: '内容运营', n: 16, extra: 25, intern: ['内容运营实习生'], campus: ['内容运营（校招）'],
    must: ['优秀的文字表达能力', '对内容热点敏感', '有内容创作经验'], bonus: ['运营过公众号或小红书账号', '会基础的图片或视频剪辑', '有内容运营实习'] },
  { dir: '新媒体运营', n: 18, extra: 25, intern: ['新媒体运营实习生'], campus: ['新媒体运营（校招）'],
    must: ['熟悉主流社交媒体平台', '有账号运营经验', '良好的文案能力'], bonus: ['有粉丝增长案例', '会视频剪辑', '有新媒体相关实习'] },
  { dir: '用户运营', n: 15, extra: 25, intern: ['用户运营实习生'], campus: ['用户运营专员（校招）'],
    must: ['良好的沟通能力和同理心', '具备数据分析意识', '执行力强'], bonus: ['有社群运营经验', '会 SQL 或 Excel 高级函数', '有用户运营实习'] },
  { dir: '市场营销', n: 12, extra: 25, intern: ['市场营销实习生', '品牌实习生'], campus: ['市场营销管培生（校招）'],
    must: ['良好的沟通表达能力', '具备市场洞察能力', '有活动策划经验'], bonus: ['有品牌或市场实习', '会做 PPT 和数据分析', '英语流利'] },
  { dir: 'UI / UX 设计', n: 5, extra: 15, intern: ['UI 设计实习生'], campus: ['交互设计师（校招）'],
    must: ['熟练使用 Figma 或 Sketch', '有完整作品集', '了解基本的交互设计原则'], bonus: ['有设计实习经历', '会动效设计', '有设计竞赛获奖'] },
] as const;

/* ---------- 公司（全部虚构） ---------- */
const NAME_A = ['星河', '云杉', '蓝鲸', '北辰', '极光', '青桐', '远山', '拾光', '海川', '鹏程', '蓝湾', '风行', '星辰', '鹿鸣', '远航', '森林', '西湖', '钱塘', '新锐', '晨曦', '飞鱼', '橙果', '白杨', '青柠', '流云', '知行', '银河', '朝阳'];
const NAME_B = ['科技', '数据', '智能', '网络', '互动', '教育', '电商', '软件', '传媒', '云', '信息', '游戏'];
type Company = { name: string; type: SeedJob['companyType'] };
const companies: Company[] = [];
const used = new Set<string>();
// 追加模式：沿用已有公司（保持公司类型一致），再补充一些新公司
if (APPEND) {
  for (const j of JSON.parse(await readFile('data/jobs/jobs.json', 'utf8')) as SeedJob[]) {
    if (!used.has(j.company)) { used.add(j.company); companies.push({ name: j.company, type: j.companyType }); }
  }
}
while (companies.length < (APPEND ? 100 : 60)) {
  const name = pick(NAME_A) + pick(NAME_B);
  if (used.has(name)) continue;
  used.add(name);
  companies.push({ name, type: weighted([['big', 0.2], ['mid', 0.4], ['startup', 0.25], ['foreign', 0.07], ['outsourcing', 0.08]]) });
}

const CITY_W: Array<[string, number]> = [['北京', 20], ['上海', 20], ['深圳', 12], ['杭州', 12], ['广州', 8], ['成都', 6], ['武汉', 6], ['南京', 6], ['西安', 5], ['苏州', 5]];
const RELEASES: Array<[string, number]> = APPEND
  ? [['2026-02-24', 30], ['2026-03-10', 12], ['2026-03-17', 12], ['2026-03-24', 12], ['2026-03-31', 12], ['2026-04-07', 12], ['2026-04-14', 10]] // 追加批次：后续每周都有新岗位
  : [['2026-02-24', 55], ['2026-03-10', 12], ['2026-03-17', 12], ['2026-03-24', 11], ['2026-03-31', 10]];
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/* ---------- 生成岗位属性与隐藏真相 ---------- */
function makeTruth(must: string[], bonus: string[], company: Company, jobType: SeedJob['jobType']): HiddenTruth {
  const realMust = [...must];
  if (bonus.length && rand() < 0.3) realMust.push(pick(bonus));   // 写成加分项、实际很看重
  const compByType = { big: [0.7, 0.95], mid: [0.4, 0.7], startup: [0.2, 0.5], foreign: [0.5, 0.8], outsourcing: [0.1, 0.3] }[company.type];
  const examP = jobType === 'campus' ? 0.85 : jobType === 'summer_intern' ? 0.6 : 0.25;
  return {
    writtenMust: must, writtenBonus: bonus, realMust,
    schoolPref: +between(company.type === 'big' ? 0.4 : 0.1, company.type === 'big' ? 0.9 : 0.6).toFixed(2),
    internshipPref: +between(0.1, 0.8).toFixed(2),
    competition: +between(compByType[0], compByType[1]).toFixed(2),
    hasExam: rand() < examP,
    examDifficulty: +between(0.2, 0.8).toFixed(2),
    replyRate: +between(0.6, 0.95).toFixed(2),
    daysNegotiable: rand() < 0.4,
    speedDays: { resume: [2, int(4, 7)], exam: [3, int(4, 6)], interview: [3, int(5, 7)] },
  };
}

const existing: SeedJob[] = APPEND ? JSON.parse(await readFile('data/jobs/jobs.json', 'utf8')) : [];
const jobs: Omit<SeedJob, 'jdText'>[] = [];
const scale = TOTAL ? TOTAL / DIRS.reduce((s, d) => s + d.n, 0) : 1;
let k = existing.length;
for (const d of DIRS) {
  const n = APPEND ? d.extra : Math.max(1, Math.round(d.n * scale));
  for (let i = 0; i < n; i++) {
    const jobType = weighted<SeedJob['jobType']>(APPEND ? [['daily_intern', 45], ['summer_intern', 30], ['campus', 25]] : [['daily_intern', 35], ['summer_intern', 25], ['campus', 40]]);
    const company = pick(companies);
    const intern = jobType !== 'campus';
    // 数据开发方向：一半岗位把 Spark / Hive 写成必须项（复盘时可被发现的规律）
    let mustPool = [...d.must];
    if (d.dir === '数据开发' && rand() < 0.5) mustPool = mustPool.filter(x => !x.includes('Spark'));
    const must = sample(mustPool, Math.min(mustPool.length, int(3, 4)));
    const bonus = sample(d.bonus, int(2, 3));
    const released = weighted(RELEASES);
    jobs.push({
      key: `J${String(++k).padStart(3, '0')}`,
      company: company.name, companyType: company.type,
      title: intern ? pick(d.intern) : pick(d.campus),
      direction: d.dir,
      city: weighted(CITY_W),
      jobType,
      ...(intern
        ? (() => { const lo = int(15, 30) * 10; return { salaryMin: lo, salaryMax: lo + int(5, 15) * 10, salaryUnit: 'day' as const }; })()
        : (() => { const lo = company.type === 'big' ? int(18, 28) : int(8, 18); return { salaryMin: lo, salaryMax: lo + int(3, 8), salaryUnit: 'month' as const }; })()),
      daysPerWeek: intern ? weighted([[3, 35], [4, 40], [5, 25]]) : null,
      months: intern ? weighted([[3, 50], [4, 25], [6, 25]]) : null,
      gradYear: intern ? weighted<number | null>([[2027, 70], [2028, 10], [null, 20]]) : weighted([[2026, 85], [2027, 15]]),
      degree: d.dir === '算法' && rand() < 0.5 ? '硕士' : '本科',
      deadlineSim: jobType === 'daily_intern' ? null : addDays(released, jobType === 'campus' ? 28 : 21),
      releasedSim: released,
      truth: { ...makeTruth(must, bonus, company, jobType), keyMust: keyMustOf(d.dir, must) },
    });
  }
}

/* ---------- 大模型撰写 JD 正文（每批 10 个） ---------- */
const TYPE_CN = { daily_intern: '日常实习', summer_intern: '暑期实习', campus: '校园招聘（全职）' };
const COMPANY_CN = { big: '大型互联网公司', mid: '中型公司', startup: '创业公司', foreign: '外企', outsourcing: '外包公司' };

function templateJd(j: Omit<SeedJob, 'jdText'>) {
  const t = j.truth;
  return `【${j.title}】${j.company}（${COMPANY_CN[j.companyType]}）· ${j.city} · ${TYPE_CN[j.jobType]}
岗位职责：
1. 参与${j.direction}相关的日常工作，与团队协作完成项目目标；
2. 按要求完成分配的任务，并持续优化工作质量。
任职要求：
${t.writtenMust.map((m, i) => `${i + 1}. ${m}；`).join('\n')}
${j.gradYear ? `${t.writtenMust.length + 1}. ${j.gradYear} 届${j.degree}及以上；` : ''}
${j.daysPerWeek ? `每周至少到岗 ${j.daysPerWeek} 天，连续实习 ${j.months} 个月以上。` : ''}
加分项：
${t.writtenBonus.map(b => `· ${b}`).join('\n')}`;
}

async function writeJds(batch: Omit<SeedJob, 'jdText'>[]): Promise<Record<string, string>> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return {};
  const spec = batch.map(j => ({
    key: j.key, title: j.title, company: `${j.company}（${COMPANY_CN[j.companyType]}）`, city: j.city, type: TYPE_CN[j.jobType],
    must: j.truth.writtenMust, bonus: j.truth.writtenBonus,
    gradYear: j.gradYear, degree: j.degree, daysPerWeek: j.daysPerWeek, months: j.months,
  }));
  const res = await fetch(`${process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_FAST_MODEL || 'deepseek-flash', temperature: 0.7, max_tokens: 8000,
      thinking: { type: 'disabled' }, response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: `你是招聘文案撰写者。请为下面每个虚构岗位写一段真实感强的中文 JD（150–250 字），包含"岗位职责"（3–4 条）和"任职要求"。
要求：
- 任职要求里必须完整写出 must 中的每一项（可以换说法，但意思不变），并写出届别、学历、到岗天数和实习时长（如有）；
- bonus 中的每一项写成"……者优先"或放在"加分项"里；
- 不要出现真实公司名，不要编造薪资。
只输出 JSON：{"items":[{"key":"J001","jd":"……"}]}
岗位：${JSON.stringify(spec)}` }],
    }),
  });
  if (!res.ok) { console.warn(`  批次失败 HTTP ${res.status}，使用模板`); return {}; }
  const body = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  try {
    const items = (JSON.parse(body.choices?.[0]?.message?.content ?? '{}').items ?? []) as Array<{ key: string; jd: string }>;
    return Object.fromEntries(items.filter(x => x.key && x.jd?.length > 60).map(x => [x.key, x.jd]));
  } catch { console.warn('  批次返回格式不正确，使用模板'); return {}; }
}

// 每批 10 个，4 批并发
const batches: Array<Omit<SeedJob, 'jdText'>[]> = [];
for (let i = 0; i < jobs.length; i += 10) batches.push(jobs.slice(i, i + 10));
const written: Array<Record<string, string>> = new Array(batches.length);
let next = 0, done = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < batches.length) {
    const b = next++;
    written[b] = await writeJds(batches[b]).catch(() => ({}));
    console.log(`已生成 ${Math.min(++done * 10, jobs.length)} / ${jobs.length}`);
  }
}));
const created: SeedJob[] = [];
let llmCount = 0;
batches.forEach((batch, b) => { for (const j of batch) { if (written[b][j.key]) llmCount++; created.push({ ...j, jdText: written[b][j.key] ?? templateJd(j) }); } });
const out: SeedJob[] = [...existing, ...created];

await mkdir('data/jobs', { recursive: true });
await writeFile('data/jobs/jobs.json', JSON.stringify(out, null, 2), 'utf8');

/* ---------- 汇总，便于人工抽查 ---------- */
const count = (f: (j: SeedJob) => string) => out.reduce<Record<string, number>>((m, j) => { const key = f(j); m[key] = (m[key] ?? 0) + 1; return m; }, {});
console.log(`\n完成：新增 ${created.length} 个（共 ${out.length} 个），其中 ${llmCount} 个由大模型撰写 JD，其余使用模板`);
console.log('方向', count(j => j.direction));
console.log('类型', count(j => j.jobType));
console.log('城市', count(j => j.city));
console.log('公司类型', count(j => j.companyType));
console.log('上线日期', count(j => j.releasedSim));
