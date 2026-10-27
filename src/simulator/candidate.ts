// 模拟招聘方"看简历"：按关键词判断候选人是否具备某项要求。
// 这是招聘方一侧的粗略判断，和 Agent 的逐条分析相互独立。
import type { ProfileData } from '@/domain/profile';

/** 软性要求（沟通、逻辑等）简历上看不出来，筛简历时不卡，面试时才体现 */
const SOFT = ['沟通', '逻辑', '执行力', '同理心', '洞察', '自己的理解', '热点敏感', '文字表达', '文案能力'];

/** 中文要求对应的关键词（英文技术名直接从要求里提取） */
const KEYWORDS: Array<[RegExp, string[]]> = [
  [/数据结构与算法/, ['数据结构', '算法', 'leetcode', 'acm', '蓝桥杯']],
  [/计算机网络/, ['计算机网络', 'tcp', 'http', '网络编程']],
  [/机器学习基础/, ['机器学习', 'sklearn', 'scikit', 'xgboost', '深度学习']],
  [/大模型基本原理/, ['大模型', 'llm', 'gpt', 'transformer', 'aigc', 'prompt']],
  [/软件测试方法/, ['测试', 'selenium', 'pytest', 'junit']],
  [/自动化测试/, ['自动化测试', 'selenium', 'pytest', 'appium']],
  [/性能测试/, ['jmeter', '性能测试', 'loadrunner', '压测']],
  [/测试相关实习/, ['测试']],
  [/数据仓库/, ['数据仓库', '数仓', 'hive']],
  [/微服务/, ['微服务', 'spring cloud', 'dubbo']],
  [/向量数据库/, ['向量', 'milvus', 'faiss']],
  [/浏览器渲染/, ['浏览器', '前端', '渲染']],
  [/交互设计原则/, ['交互', 'ux', 'figma', '用户体验']],
  [/后端开发能力|后端实习/, ['后端', 'spring', 'java', 'go', 'django', 'flask', 'node']],
  [/需求文档和原型/, ['prd', '需求文档', '原型', 'axure', '墨刀']],
  [/数据分析|PPT/, ['数据分析', 'sql', 'excel', 'pandas', 'tableau', 'bi', 'spss']],
  [/剪辑/, ['剪辑', 'premiere', '剪映', 'photoshop', 'final cut']],
  [/动效/, ['动效', 'after effects', 'ae']],
  [/内容创作/, ['内容', '创作', '写作', '公众号', '小红书', '博客', '视频']],
  [/账号运营|公众号或小红书|粉丝增长/, ['公众号', '小红书', '抖音', 'b站', '账号', '粉丝']],
  [/社交媒体/, ['小红书', '抖音', '微博', 'b站', '公众号', '社交媒体']],
  [/社群运营/, ['社群', '社区']],
  [/活动策划/, ['活动', '策划', '学生会', '社团']],
  [/数据可视化/, ['可视化', 'echarts', 'tableau', 'matplotlib', 'bi']],
  [/个人作品或开源/, ['github', '开源', '个人作品']],
  [/校园项目或作品/, ['项目', '作品']],
  [/完整作品集/, ['作品集']],
  [/技术背景或会写代码/, ['python', 'java', 'c++', 'javascript', '编程', '开发']],
  [/论文/, ['论文', '发表', 'sci', '期刊', '会议']],
  [/竞赛获奖/, ['kaggle', '天池', '竞赛', '比赛', '大赛']],
  [/前端开发/, ['前端', 'react', 'vue', 'html']],
  [/小程序/, ['小程序']],
  [/NLP|推荐项目/, ['nlp', '推荐', '自然语言', '文本']],
  [/RAG|Agent/, ['rag', 'agent', '智能体', '大模型', 'llm']],
  [/微调/, ['微调', 'lora', 'sft', 'fine-tun']],
  [/英语/, ['cet-6', '六级', '雅思', '托福', 'ielts', 'toefl', '英语']],
  [/产品.*实习/, ['产品']],
  [/数据相关实习/, ['数据']],
  [/内容运营实习/, ['内容', '运营']],
  [/品牌或市场实习/, ['品牌', '市场']],
  [/设计实习/, ['设计']],
  [/新媒体.*实习/, ['新媒体', '公众号', '小红书', '运营']],
  [/用户运营实习/, ['用户', '运营']],
  [/运营相关实习/, ['运营']],
];

/** 候选人简历中的文字（小写），分为全部经历和仅实习经历 */
export function candidateText(p: ProfileData) {
  const exp = (kind?: string) => p.experiences.filter(e => !kind || e.kind === kind)
    .map(e => [e.title, e.role, e.detail, ...e.tech].join(' ')).join(' ');
  const all = [p.basics.major ?? '', ...p.skills, ...p.courses, ...p.awards, exp()].join(' ').toLowerCase();
  return { all, internship: exp('internship').toLowerCase(), awards: p.awards.join(' ').toLowerCase(), hasInternship: p.experiences.some(e => e.kind === 'internship') };
}
export type CandidateText = ReturnType<typeof candidateText>;

export type ReqCheck = 'met' | 'missing' | 'soft';

export function checkRequirement(req: string, c: CandidateText): ReqCheck {
  if (SOFT.some(k => req.includes(k))) return 'soft';
  const scope = /实习/.test(req) ? c.internship : /获奖/.test(req) ? c.awards : c.all;
  const mapped = KEYWORDS.find(([re]) => re.test(req))?.[1];
  // 英文技术名，如 "Java 或 Go"、"Spark 或 Hive"、"PyTorch 或 TensorFlow"
  const ascii = (req.match(/[A-Za-z][A-Za-z+#.]*/g) ?? []).filter(w => w.length >= 2 && !['API'].includes(w)).map(w => w.toLowerCase());
  const words = [...(mapped ?? []), ...ascii];
  if (!words.length) return 'soft'; // 识别不了的要求不卡简历
  return words.some(w => contains(scope, w)) ? 'met' : 'missing';
}

/** 短英文词（如 go、bi、ae）要求前后不是字母，避免 "mongo"、"bilibili" 误命中 */
function contains(text: string, w: string) {
  if (!/^[a-z0-9+#.]{1,3}$/.test(w)) return text.includes(w);
  const esc = w.replace(/[+#.]/g, m => `\\${m}`);
  return new RegExp(`(^|[^a-z])${esc}($|[^a-z])`).test(text);
}
