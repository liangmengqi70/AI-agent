'use client';
import { useEffect, useState } from 'react';
import { useRound } from '@/components/workspace/round-context';
import s from '../workspace.module.css';

// 策略页（只读）：现在用什么规则、规则是怎么变过来的
type View = {
  version: number; usedBy: string;
  params: Array<{ k: string; v: string; src: { label: string; kind: 'user' | 'default' | 'review' } }>;
  history: Array<{ version: number; date: string | null; roundNo: number | null; title: string; changes: Array<{ text: string; accepted: boolean; kind: string }> }>;
} | null;

const md = (d: string | null) => d ? d.replace(/^\d+-(\d+)-(\d+)$/, (_, m, dd) => `${+m} 月 ${+dd} 日`) : '';

export default function StrategyPage() {
  const { data: round } = useRound();
  const [v, setV] = useState<View | undefined>(undefined);
  useEffect(() => { fetch('/api/strategies').then(r => r.json()).then(setV).catch(() => setV(null)); }, [round?.round.strategyVersion, round?.round.no]);

  if (v === undefined) return <div className={s.page}><div className={`card ${s.state}`}>正在读取…</div></div>;
  if (!v) return <div className={s.page}><div className={`card ${s.state}`}><b>还没有策略</b>确认画像与偏好后会生成策略 v1。</div></div>;

  return (
    <div className={s.page}>
      <div className="card">
        <div className={s.cardH}><h3>当前策略 v{v.version}</h3><span className={s.sub}>{v.usedBy}</span></div>
        <div className={s.cardB} style={{ paddingTop: 6 }}>
          {v.params.map((p, i) => (
            <div key={i} className={s.param}><span className={s.k}>{p.k}</span><span>{p.v}</span><span className={`${s.srcTag} ${s[p.src.kind]}`}>{p.src.label}</span></div>
          ))}
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            "你设置"的部分（方向、城市、到岗等）在<a href="/profile" style={{ textDecoration: 'underline' }}>画像页</a>修改；规则类参数只能通过复盘建议调整。
          </p>
        </div>
      </div>
      <div className="card">
        <div className={s.cardH}><h3>版本历史</h3><span className={s.sub}>每次变化的来源和原因</span></div>
        <div className={s.cardB} style={{ paddingTop: 4 }}>
          {v.history.map(h => {
            const acc = h.changes.filter(c => c.accepted).length;
            return (
              <div key={h.version} className={s.ver}>
                <div><div className={s.vn}>v{h.version}</div><div className={s.vd}>{md(h.date)}</div></div>
                <div>
                  <b>{h.title}</b>
                  {h.roundNo && <> · 你采纳了 {acc} 条建议{h.changes.length - acc ? `，${h.changes.length - acc} 条未采纳` : ''}
                    <a href={`/review?round=${h.roundNo}`} style={{ fontSize: 12, color: 'var(--muted)', textDecoration: 'underline', marginLeft: 6 }}>查看这次复盘 ›</a></>}
                  <ul>{h.changes.map((c, i) => <li key={i} className={c.accepted ? '' : s.rej}>{c.text}{c.accepted ? '' : '（未采纳）'}</li>)}</ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
