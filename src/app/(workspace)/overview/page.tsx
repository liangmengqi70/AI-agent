'use client';
import { useState } from 'react';
import { useRound } from '@/components/workspace/round-context';
import s from '../workspace.module.css';

// 总览：本轮进度、待你处理、当前策略、最近动作
const STEPS = [
  { key: 'screen', label: '拉取与过滤' },
  { key: 'parse', label: '解析岗位要求' },
  { key: 'match', label: '逐条匹配' },
  { key: 'tiers', label: '判定档位' },
  { key: 'apply', label: '确认投递' },
  { key: 'track', label: '状态跟踪' },
  { key: 'review', label: '复盘' },
];

export default function OverviewPage() {
  const { data, loaded, refresh } = useRound();
  const [retrying, setRetrying] = useState(false);
  if (!loaded) return <div className={s.page}><div className={`card ${s.state}`}>正在读取…</div></div>;
  if (!data) return (
    <div className={s.page}><div className={`card ${s.state}`}><b>还没有开始求职</b>先上传简历并确认画像，Agent 会自动开始第 1 轮。<br /><a className="btn primary" href="/upload" style={{ marginTop: 14 }}>上传简历</a></div></div>
  );

  const r = data.round;
  // 生成推荐的步骤映射到进度条前 4 格：拉取与过滤 / 解析 / 匹配 / 判定档位（含排序和合并提问）
  const STAGE: Record<string, number> = { screen: 0, parse: 1, match: 2, tiers: 3, arrange: 3, questions: 3 };
  const busy = r.status === 'generating' || r.status === 'failed';
  const cur = busy ? STAGE[r.step ?? 'screen'] ?? 0 : 4;
  const stepState = (i: number) => {
    if (i < 4) return i < cur ? 'done' : i === cur && busy ? (r.status === 'failed' ? 'now' : 'run') : '';
    if (i === 4) return r.status === 'awaiting_apply' ? 'now' : ['tracking', 'reviewing', 'awaiting_review_decision', 'completed'].includes(r.status) ? 'done' : '';
    if (i === 5) return r.status === 'tracking' ? 'now' : ['reviewing', 'awaiting_review_decision', 'completed'].includes(r.status) ? 'done' : '';
    if (i === 6) return r.status === 'reviewing' ? 'run' : r.status === 'awaiting_review_decision' ? 'now' : r.status === 'completed' ? 'done' : '';
    return '';
  };
  const summaryOf = (key: string, title: string) => data.steps.find(x => x.step === key && x.title === title)?.summary ?? '';
  const ex = [summaryOf('screen', '硬过滤'), summaryOf('parse', '解析岗位要求').split('，')[0], summaryOf('match', '逐条匹配').split('，')[0], summaryOf('tiers', '判定档位'), r.status === 'awaiting_apply' ? '等你确认' : `已投递 ${data.apps.thisRound} 个`, r.status === 'tracking' ? '等待回复' : '已有回复', r.status === 'awaiting_review_decision' ? (data.review?.pending ? `${data.review.pending} 条建议` : '等你确认') : ''];

  async function retry() {
    setRetrying(true);
    await fetch('/api/rounds/current/retry', { method: 'POST' });
    setRetrying(false); refresh();
  }

  const shown = data.count.rec + data.count.con;
  return (
    <div className={s.page}>
      <div className="card">
        <div className={s.cardH}><h3>第 {r.no} 轮进度</h3><span className={s.sub}>策略 v{r.strategyVersion} · 开始于 {r.startedSim}</span></div>
        <div className={s.stepper}>
          {STEPS.map((st, i) => {
            const state = stepState(i);
            return (
              <div key={st.key} style={{ display: 'contents' }}>
                {i > 0 && <div className={`${s.link} ${stepState(i - 1) === 'done' ? s.done : ''}`} />}
                <div className={`${s.step} ${state ? s[state] : ''}`}>
                  <div className={s.dot}>{state === 'done' ? '✓' : i + 1}</div>
                  <div className={s.lb}>{st.label}</div>
                  <div className={s.ex}>{state === 'run' ? '进行中…' : state ? ex[i] : ''}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={s.grid2}>
        <div className="card">
          <div className={s.cardH}><h3>待你处理</h3><span className={s.sub}>Agent 正在等待这些决定</span></div>
          <div className={s.cardB} style={{ paddingTop: 6 }}>
            {r.status === 'generating' && <p className="muted" style={{ lineHeight: 1.8, padding: '8px 0' }}>Agent 正在生成第 {r.no} 轮推荐，大约需要 1–2 分钟。<br />你可以先离开，完成后会出现在这里。</p>}
            {r.status === 'failed' && (
              <div className={s.todo}><div className={s.ic}>!</div><div className={s.tx}><b>推荐生成失败</b><span>{r.error ?? '请稍后重试'}</span></div>
                <button className="btn primary sm" disabled={retrying} onClick={retry}>{retrying ? '重试中…' : '重试'}</button></div>
            )}
            {r.status === 'awaiting_apply' && (
              <div className={s.todo}><div className={s.ic}>{shown}</div><div className={s.tx}><b>确认第 {r.no} 轮推荐的 {shown} 个岗位</b><span>推荐 {data.count.rec} 个 · 可以考虑 {data.count.con} 个</span></div>
                <a className="btn primary sm" href="/recommend">去确认</a></div>
            )}
            {r.status === 'tracking' && (data.apps.unseen > 0
              ? <div className={s.todo}><div className={s.ic}>{data.apps.unseen}</div><div className={s.tx}><b>{data.apps.unseen} 个投递有新消息</b><span>笔试、面试或拒信，打开卡片查看详情</span></div>
                <a className="btn primary sm" href="/progress">查看</a></div>
              : <p className="muted" style={{ lineHeight: 1.8, padding: '8px 0' }}>第 {r.no} 轮已投递 {data.apps.thisRound} 个，正在等待结果。<br />点右上角"推进 1 天 / 7 天"，结果会陆续出现在投递进度页。<br />投递满 7 天（或已有 60% 结果）后会自动复盘。</p>)}
            {r.status === 'reviewing' && <p className="muted" style={{ lineHeight: 1.8, padding: '8px 0' }}>Agent 正在复盘第 {r.no} 轮：统计结果、阅读拒信、对比岗位要求，大约需要 1 分钟。</p>}
            {r.status === 'awaiting_review_decision' && (
              <div className={s.todo}><div className={s.ic}>{data.review?.pending || '✓'}</div>
                <div className={s.tx}><b>{data.review?.pending ? `处理第 ${r.no} 轮复盘的 ${data.review.pending} 条调整建议` : `第 ${r.no} 轮复盘已完成，开始下一轮`}</b><span>采纳的建议会生成新策略，用于第 {r.no + 1} 轮推荐</span></div>
                <a className="btn primary sm" href="/review">去复盘</a></div>
            )}
          </div>
        </div>
        <div className="card">
          <div className={s.cardH}><h3>Agent 刚刚做了什么</h3></div>
          <div className={s.cardB} style={{ paddingTop: 6 }}>
            {[...data.steps].reverse().slice(0, 6).map((x, i) => (
              <div key={i} className={s.line}><span className={s.k}>{x.title}</span><span>{x.summary}</span></div>
            ))}
            {!data.steps.length && <p className="muted">还没有记录</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
