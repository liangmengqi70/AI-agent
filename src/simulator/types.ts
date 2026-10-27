// 模拟器的数据类型。注意：simulator/ 目录只能被 platform/mock/ 和脚本引用，Agent 代码禁止引用。

/** 隐藏真相：招聘方真实的偏好，Agent 看不到 */
export type HiddenTruth = {
  writtenMust: string[];        // JD 中写的必须项
  writtenBonus: string[];       // JD 中写的加分项
  realMust: string[];           // 实际最看重的要求（可能包含写成加分项的内容）
  keyMust?: string | null;      // 这个方向"真正卡人"的必须项（JD 中写为必须项时才有）；缺了基本过不了简历关
  schoolPref: number;           // 对学校背景的看重程度 0–1
  internshipPref: number;       // 对实习经历的看重程度 0–1
  competition: number;          // 竞争激烈程度 0–1
  hasExam: boolean;             // 是否有笔试 / 测评
  examDifficulty: number;       // 笔试难度 0–1
  replyRate: number;            // 会回复的概率 0–1
  daysNegotiable: boolean;      // 到岗天数能否协商
  speedDays: { resume: [number, number]; exam: [number, number]; interview: [number, number] }; // 各环节回复用时（天）
};

/** 生成脚本输出、导入数据库的岗位记录 */
export type SeedJob = {
  key: string;
  company: string;
  companyType: 'big' | 'mid' | 'startup' | 'foreign' | 'outsourcing';
  title: string;
  direction: string;
  city: string;
  jobType: 'daily_intern' | 'summer_intern' | 'campus';
  salaryMin: number;
  salaryMax: number;
  salaryUnit: 'day' | 'month';
  daysPerWeek: number | null;
  months: number | null;
  gradYear: number | null;
  degree: string;
  deadlineSim: string | null;
  releasedSim: string;
  jdText: string;
  truth: HiddenTruth;
};
