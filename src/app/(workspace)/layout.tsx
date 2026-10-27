'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { RoundProvider, statusOf, useRound } from '@/components/workspace/round-context';
import { useToast } from '@/components/common/ui';
import s from './workspace.module.css';

const NAV = [
  ['overview', '总览'], ['recommend', '推荐'], ['progress', '投递进度'], ['review', '复盘'],
  ['strategy', '策略'], ['profile', '画像'],
] as const;

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <RoundProvider><Shell>{children}</Shell></RoundProvider>;
}

function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const key = path.split('/')[1];
  const { data, refresh } = useRound();
  const { toast, toastNode } = useToast();
  const st = statusOf(data);
  const title = key === 'recommend' && data ? `第 ${data.round.no} 轮推荐` : NAV.find(n => n[0] === key)?.[1] ?? '';
  // 后台任务完成时提示：复盘完成 / 下一轮推荐生成完成
  const prevStatus = useRef<string | null>(null);
  useEffect(() => {
    const now = data?.round.status ?? null;
    if (prevStatus.current === 'reviewing' && now === 'awaiting_review_decision') toast(data!.review?.total ? `第 ${data!.round.no} 轮复盘已完成，有 ${data!.review.total} 条调整建议` : `第 ${data!.round.no} 轮复盘已完成`);
    if (prevStatus.current === 'generating' && now === 'awaiting_apply') toast(`第 ${data!.round.no} 轮推荐已生成`);
    prevStatus.current = now;
  }, [data, toast]);
  const [busy, setBusy] = useState(false);
  const canAdvance = data?.round.status === 'tracking';
  async function advance(days: number) {
    setBusy(true);
    try {
      const res = await fetch('/api/clock/advance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ days }) });
      const body = await res.json();
      toast(res.ok ? `已推进到 ${body.date.slice(5).replace('-', '/')}：${body.summary}${body.reviewStarted ? '。满足复盘条件，Agent 开始复盘' : ''}` : body.error || '推进失败，请重试');
      refresh();
      window.dispatchEvent(new Event('sim-advanced')); // 通知当前页面重新读取
    } catch { toast('网络或服务异常，请稍后重试'); }
    finally { setBusy(false); }
  }
  const recBadge = data?.round.status === 'awaiting_apply' ? data.count.rec + data.count.con : 0;
  return (
    <div className={s.app}>
      <aside className={s.nav}>
        <div className={s.brand}>AI Agent 求职管家<small>实习 / 校招</small></div>
        {NAV.map(([k, label]) => (
          <a key={k} href={`/${k}`} className={key === k ? s.on : ''}>
            {label}{k === 'recommend' && recBadge > 0 && <span className={s.badge}>{recBadge}</span>}
            {k === 'progress' && (data?.apps.unseen ?? 0) > 0 && <span className={s.badge}>{data!.apps.unseen}</span>}
            {k === 'review' && (data?.review?.pending ?? 0) > 0 && <span className={s.badge}>{data!.review!.pending}</span>}
          </a>
        ))}
        <div className={s.persona}><b>我的求职</b><br />策略 v{data?.round.strategyVersion ?? 1}<br /><a href="/" style={{ textDecoration: 'underline' }}>回到首页</a></div>
      </aside>
      <div className={s.main}>
        <header className={s.topbar}>
          <h1>{title}</h1>
          <span className={`${s.status} ${st.red ? '' : s.grey}`}><i />{st.text}</span>
          <div className={s.clock}>
            模拟日期 <b>{data ? data.simDate.replace(/^(\d+)-(\d+)-(\d+)$/, (_, y, m, d) => `${y} 年 ${+m} 月 ${+d} 日`) : '—'} · 春招</b>
            {[1, 7].map(n => (
              <button key={n} className="btn" disabled={!canAdvance || busy} title={canAdvance ? '' : data?.round.status === 'awaiting_review_decision' ? '先处理复盘建议' : '先确认本轮投递，再推进时间'} onClick={() => void advance(n)}>推进 {n} 天</button>
            ))}
            <button className="btn primary" onClick={() => toast('第二版开放：使用 ResumeIQ 账号登录，保存进度')}>登录保存进度</button>
          </div>
        </header>
        {children}
      </div>
      {toastNode}
    </div>
  );
}
