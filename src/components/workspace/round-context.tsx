'use client';
// 工作台共享的"当前轮次"数据：生成中每 2 秒刷新，其他状态每 15 秒刷新
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type RoundData = {
  round: { no: number; status: string; step: string | null; error: string | null; strategyVersion: number; startedSim: string };
  simDate: string;
  count: { rec: number; con: number; no: number };
  apps: { thisRound: number; total: number; unseen: number };
  review: { status: string; total: number; pending: number } | null;
  steps: Array<{ step: string; actor: string; title: string; summary: string | null; detail: string | null; at: string }>;
} | null;

const Ctx = createContext<{ data: RoundData; loaded: boolean; refresh: () => void }>({ data: null, loaded: false, refresh: () => {} });
export const useRound = () => useContext(Ctx);

export function RoundProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<RoundData>(null);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(() => {
    fetch('/api/rounds/current').then(r => r.json()).then(d => { setData(d); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(refresh, ['generating', 'reviewing'].includes(data?.round.status ?? '') ? 2000 : 15000);
    return () => clearInterval(t);
  }, [refresh, data?.round.status]);
  return <Ctx.Provider value={{ data, loaded, refresh }}>{children}</Ctx.Provider>;
}

/** 顶栏状态文字：红色 = 等你处理；灰色 = Agent 在处理或没有待办 */
export function statusOf(d: RoundData): { text: string; red: boolean } {
  if (!d) return { text: '还没有开始', red: false };
  const n = d.round.no;
  switch (d.round.status) {
    case 'generating': return { text: `第 ${n} 轮 · 正在生成推荐`, red: false };
    case 'awaiting_apply': return { text: `第 ${n} 轮 · 等你确认 ${d.count.rec + d.count.con} 个岗位`, red: true };
    case 'failed': return { text: `第 ${n} 轮 · 生成失败`, red: true };
    case 'tracking': return { text: `第 ${n} 轮 · 已投递 ${d.apps.thisRound} 个，等待结果`, red: false };
    case 'reviewing': return { text: `第 ${n} 轮 · 正在复盘`, red: false };
    case 'awaiting_review_decision': return d.review?.pending
      ? { text: `第 ${n} 轮复盘 · ${d.review.pending} 条建议待处理`, red: true }
      : { text: `第 ${n} 轮复盘 · 等你开始下一轮`, red: true };
    default: return { text: `第 ${n} 轮`, red: false };
  }
}
