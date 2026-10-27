// 岗位的公开信息类型（Agent 可见）。隐藏真相的类型在 simulator/types.ts，Agent 不可引用。
/** 岗位公开信息（不含隐藏真相） */
export type PublicJob = {
  id: string;
  company: string;
  companyType: 'big' | 'mid' | 'startup' | 'foreign' | 'outsourcing';
  title: string;
  direction: string;
  city: string;
  jobType: 'daily_intern' | 'summer_intern' | 'campus';
  salaryMin: number | null;
  salaryMax: number | null;
  salaryUnit: 'day' | 'month';
  daysPerWeek: number | null;
  months: number | null;
  gradYear: number | null;
  degree: string | null;
  deadlineSim: string | null;
  releasedSim: string;
  jdText: string;
};
