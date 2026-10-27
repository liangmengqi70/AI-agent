'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRound } from '@/components/workspace/round-context';
import s from '../workspace.module.css';

// 投递进度：按状态分列展示每个投递，点开查看时间线、当时的推荐依据和岗位描述
type Ev = { type: string; simDate: string; message: string | null; seen: boolean };
type App = {
  id: string; roundNo: number; jobId: string; tier: 'rec' | 'con'; status: string; appliedSim: string; lastEventSim: string | null;
  events: Ev[]; title: string; company: string; city: string; jobType: string; isNew: boolean;
  salary: { min: number | null; max: number | null; unit: 'day' | 'month' } | null; jd: string; reason: string | null;
  judgments: Array<{ req: string; kind: 'must' | 'bonus'; status: 'ok' | 'part' | 'no'; evidence: string }>;
};

const COLS: Array<[string, string, string]> = [
  ['waiting', '等待回复', '还没有投递'],
  ['exam', '笔试 / 测评', '暂无'],
  ['interview', '面试', '暂无'],
  ['offer', 'Offer', '暂无'],
  ['rejected', '未通过', '暂无'],
  ['no_response', '无回应', '投递 7 天没有消息的会出现在这里'],
];
const STATUS_CN = Object.fromEntries(COLS.map(([k, n]) => [k, n]));
const EVENT_CN: Record<string, string> = {
  applied: '已投递', resume_pass: '收到笔试 / 面试邀请', exam_notice: '收到笔试 / 测评通知', exam_pass: '笔试通过',
  interview: '收到面试邀请', offer: '收到 Offer', rejected: '未通过', no_response: '7 天没有消息，标记为无回应',
};
const TYPE_CN: Record<string, string> = { daily_intern: '日常实习', summer_intern: '暑期实习', campus: '校招' };
const fmt = (d: string) => d.replace(/^(\d+)-(\d+)-(\d+)$/, (_, y, m, dd) => `${y} 年 ${+m} 月 ${+dd} 日`);
const ICON = { ok: '✓', part: '△', no: '✗' };
/** 被拒时写明是哪一步：简历 / 笔试 / 面试 */
const rejectStage = (evs: Ev[]) => evs.some(e => e.type === 'interview') ? '面试未通过' : evs.some(e => e.type === 'exam_notice') ? '笔试未通过' : '简历未通过';
const eventText = (e: Ev, evs: Ev[]) => e.type === 'rejected' ? rejectStage(evs) : EVENT_CN[e.type] ?? e.type;
const pay = (x: App['salary']) => !x?.min ? '薪资面议' : x.unit === 'day' ? `${x.min}–${x.max} 元/天` : `${x.min}–${x.max}K/月`;
const tierTag = (t: 'rec' | 'con') => t === 'rec' ? <span className="tag rec">推荐</span> : <span className="tag con">可以考虑</span>;

export default function ProgressPage() {
  const { data: round, refresh } = useRound();
  const [apps, setApps] = useState<App[] | null>(null);
  const [tab, setTab] = useState<number | 'all'>('all');
  const [open, setOpen] = useState<App | null>(null);
  // 从复盘页跳转时只看简历筛选就被拒的投递：?status=resume_reject&round=N
  const [only, setOnly] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setOnly(q.get('status'));
    if (Number(q.get('round'))) setTab(Number(q.get('round')));
  }, []);
  const resumeReject = (a: App) => a.status === 'rejected' && !a.events.some(e => e.type === 'exam_notice' || e.type === 'interview');

  const load = useCallback(() => fetch('/api/applications').then(r => r.json()).then(d => setApps(d.items ?? [])), []);
  useEffect(() => { void load(); }, [load, round?.simDate, round?.round.status]);
  useEffect(() => { const f = () => void load(); window.addEventListener('sim-advanced', f); return () => window.removeEventListener('sim-advanced', f); }, [load]);

  async function show(a: App) {
    setOpen(a);
    if (a.isNew) {
      await fetch(`/api/applications/${a.id}/seen`, { method: 'POST' });
      setApps(list => list && list.map(x => x.id === a.id ? { ...x, isNew: false, events: x.events.map(e => ({ ...e, seen: true })) } : x));
      refresh();
    }
  }

  if (!apps) return <div className={s.page}><div className={`card ${s.state}`}>正在读取…</div></div>;
  if (!apps.length) return (
    <div className={s.page}><div className={`card ${s.state}`}>
      <b>还没有投递</b>在推荐页勾选岗位并确认投递后，结果会出现在这里。<br />
      <a className="btn primary" href="/recommend" style={{ marginTop: 14 }}>去推荐页</a>
    </div></div>
  );

  const rounds = [...new Set(apps.map(a => a.roundNo))].sort((a, b) => a - b);
  const shown = apps.filter(a => tab === 'all' || a.roundNo === tab);
  const lastText = (a: App) => {
    const e = a.events[a.events.length - 1];
    return e ? `${e.simDate.slice(5).replace('-', '/')} ${eventText(e, a.events)}` : '';
  };

  return (
    <div className={s.page}>
      <div className={s.boardTools}>
        <div className={s.tabs}>
          <button className={tab === 'all' ? s.on : ''} onClick={() => setTab('all')}>全部轮次</button>
          {rounds.map(n => <button key={n} className={tab === n ? s.on : ''} onClick={() => setTab(n)}>第 {n} 轮</button>)}
        </div>
        {only === 'resume_reject' && <button className="btn sm" onClick={() => { setOnly(null); history.replaceState(null, '', '/progress'); }}>只看简历未通过的 · 显示全部 ×</button>}
        <span className="muted" style={{ fontSize: 12, marginLeft: 'auto', textAlign: 'right', lineHeight: 1.6 }}>
          笔试 / 测评只有部分岗位有（校招、暑期实习较常见），没有的会直接进入面试<br />投递后 7 天没有任何消息，自动标记为"无回应"
        </span>
      </div>
      <div className={s.board}>
        {COLS.filter(([key]) => only !== 'resume_reject' || key === 'rejected').map(([key, name, empty]) => {
          const items = shown.filter(a => a.status === key && (only !== 'resume_reject' || resumeReject(a)));
          return (
            <div key={key} className={s.col}>
              <div className={s.colH}>{name}<span className={s.c}>{items.length}</span></div>
              {items.length ? items.map(a => (
                <div key={a.id} className={s.bcard} onClick={() => void show(a)}>
                  <div className={s.t}>{a.title}</div>
                  <div className={s.m}>{a.company} · {a.city}</div>
                  <div className={s.e}>{lastText(a)}</div>
                  <div className={s.tags}>
                    {a.isNew && <span className={`tag ${s.newTag}`}>新</span>}
                    {tierTag(a.tier)}<span className="tag plain">第 {a.roundNo} 轮</span>
                  </div>
                </div>
              )) : <div className={s.empty}>{key === 'waiting' && apps.length ? '暂无' : empty}</div>}
            </div>
          );
        })}
      </div>
      {round?.round.status === 'tracking' && (
        <p className="muted" style={{ fontSize: 12 }}>投递结果会随模拟时间陆续出现，点右上角"推进 1 天 / 7 天"。</p>
      )}

      {open && <>
        <div className={s.overlay} onClick={() => setOpen(null)} />
        <aside className={s.drawer}>
          <button className={s.x} onClick={() => setOpen(null)}>×</button>
          <h2>{open.title}</h2>
          <p className="muted" style={{ marginTop: 6 }}>{open.company} · {open.city} · {TYPE_CN[open.jobType] ?? ''} · {pay(open.salary)} · 第 {open.roundNo} 轮投递</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>{tierTag(open.tier)}<span className="tag plain">{open.status === 'rejected' ? rejectStage(open.events) : STATUS_CN[open.status]}</span></div>
          <div className={s.sec}><h3>进度</h3>
            <div className={s.tl}>
              {[...open.events].reverse().map((e, i) => (
                <div key={i} className={`${s.tlI} ${i === 0 ? '' : s.grey}`}>
                  <span className={s.p} />
                  <div>
                    <div className={s.d}>{fmt(e.simDate)}</div>
                    <div className={s.txt}>{eventText(e, open.events)}</div>
                    {e.message && <div className={s.msg}>{e.message}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {open.judgments.length > 0 && (
            <div className={s.sec}><h3>当时的推荐依据</h3>
              {open.reason && <div className={s.reason} style={{ marginTop: 0 }}>{open.reason}</div>}
              {open.judgments.map((j, i) => (
                <div key={i} className={s.req}>
                  <div className={`${s.ri} ${s[j.status]}`}>{ICON[j.status]}</div>
                  <div>{j.req}<span className={s.kind}>{j.kind === 'must' ? '必须项' : '加分项'}</span></div>
                  <div className={s.ev}>{j.evidence}</div>
                </div>
              ))}
            </div>
          )}
          {open.jd && (
            <details className={s.sec}>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>岗位描述（JD 原文）</summary>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.8, marginTop: 8, color: 'var(--ink2)' }}>{open.jd}</div>
            </details>
          )}
        </aside>
      </>}
    </div>
  );
}
