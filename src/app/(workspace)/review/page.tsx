'use client';
import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRound } from '@/components/workspace/round-context';
import { useToast } from '@/components/common/ui';
import s from '../workspace.module.css';

// 复盘页：关键数字、本轮发现、调整建议（采纳 / 不采纳）、各环节与分组通过率
type Group = { key: string; n: number; resumePass: number; resumeReject: number; pending: number; interview: number };
type Stats = {
  applied: number; withResult: number; pending: number; noResponse: number; resumePass: number; resumeReject: number;
  examInvited: number; examPass: number; examFail: number; examPending: number;
  interview: number; interviewFail: number; interviewPending: number; offer: number; asOf: string;
  groups: Record<'tier' | 'direction' | 'city' | 'companyType' | 'jobType', Group[]>;
};
type Proposal = {
  id: string; seq: number; kind: 'rule' | 'ratio' | 'preference'; title: string; basisLabel: string; notes: string[]; weak: boolean;
  decision: 'pending' | 'accepted' | 'rejected'; changeText: string;
  evidence: { bullets: string[]; cautions: string[]; tip: string | null };
  change: { type: string; city?: string; direction?: string };
};
type View = {
  tabs: Array<{ no: number; hasReview: boolean }>; roundNo: number; roundStatus: string; strategyVersion: number; nextStrategyVersion: number;
  progress: { applied: number; withResult: number; days: number; timing: { minResults: number; resultRatio: number; normalDays: number; forceDays: number } } | null;
  review: { status: string; stats: Stats | null; findings: Array<{ type: 'problem' | 'preference' | 'normal'; title: string; detail: string; proposals: number[] }>; error: string | null; createdSim: string } | null;
  proposals: Proposal[];
} | null;

const NUM = '①②③④⑤⑥⑦⑧⑨⑩';
const FT = { problem: '问题', preference: '偏好', normal: '正常' };
/** 卡片小字：通过 / 未通过 / 还没出结果 */
const outcome = (pass: number, fail: number, pending: number, passLabel = '通过') =>
  [`${passLabel} ${pass}`, `未通过 ${fail}`, pending ? `还没出结果 ${pending}` : ''].filter(Boolean).join(' · ');
const md = (d: string) => d.replace(/^\d+-(\d+)-(\d+)$/, (_, m, dd) => `${+m} 月 ${+dd} 日`);

/** 证据里用 **加粗** 标出的关键数字，显示为红色 */
function rich(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith('**') ? <b key={i} className={s.hl}>{part.slice(2, -2)}</b> : part);
}

/** 偏好类建议的按钮文字更具体，如"移除杭州 / 保持不变" */
function labels(p: Proposal): [string, string] {
  if (p.change.type === 'remove_city') return [`移除${p.change.city}`, '保持不变'];
  if (p.change.type === 'promote_direction') return ['加入可接受方向', '保持不变'];
  if (p.change.type === 'exclude_direction') return ['不再推荐', '保持不变'];
  return ['采纳', '不采纳'];
}

export default function ReviewPage() {
  return <Suspense fallback={null}><ReviewInner /></Suspense>;
}

function ReviewInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: round, refresh } = useRound();
  const { toast, toastNode } = useToast();
  const [view, setView] = useState<View | undefined>(undefined);
  const [roundNo, setRoundNo] = useState<number | null>(Number(params.get('round')) || null);
  const [flash, setFlash] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const status = round?.round.status;

  const load = useCallback(() => fetch(`/api/reviews${roundNo ? `?round=${roundNo}` : ''}`).then(r => r.json()).then(setView), [roundNo]);
  useEffect(() => { void load(); }, [load, status, round?.simDate]);

  if (view === undefined) return <div className={s.page}><div className={`card ${s.state}`}>正在读取…</div></div>;
  if (!view) return <div className={s.page}><div className={`card ${s.state}`}><b>还没有开始求职</b>确认投递并推进时间后，Agent 会自动复盘。</div></div>;

  const tabs = view.tabs.filter(t => t.hasReview || t.no === view.roundNo);
  const tabBar = tabs.length > 1 && (
    <div className={s.tabs}>{tabs.map(t => <button key={t.no} className={t.no === view.roundNo ? s.on : ''} onClick={() => setRoundNo(t.no)}>第 {t.no} 轮</button>)}</div>
  );

  // 还没到复盘的阶段
  if (!view.review) {
    const p = view.progress;
    return (
      <div className={s.page}>{tabBar}
        <div className={`card ${s.state}`}>
          {view.roundStatus === 'reviewing' ? <><b>Agent 正在复盘第 {view.roundNo} 轮</b>正在统计结果、阅读拒信、对比岗位要求，大约需要 1 分钟。</>
            : p ? <><b>第 {view.roundNo} 轮还没到复盘的时候</b>
              投递满 {p.timing.normalDays} 天（或已有 {Math.round(p.timing.resultRatio * 100)}% 结果）后会自动复盘，满 {p.timing.forceDays} 天一定复盘。<br />
              现在：{p.applied} 个投递中 <b style={{ display: 'inline', fontSize: 14 }}>{p.withResult}</b> 个已回复（通过或被拒都算），已投递 {p.days} 天。点右上角"推进时间"查看新消息。</>
              : <><b>第 {view.roundNo} 轮还没有投递</b>确认投递并推进时间后，Agent 会自动复盘。</>}
        </div>
      </div>
    );
  }

  const rv = view.review;
  const st = rv.stats;
  const editable = view.roundStatus === 'awaiting_review_decision';
  const pending = view.proposals.filter(p => p.decision === 'pending').length;
  const accepted = view.proposals.filter(p => p.decision === 'accepted').length;

  async function decide(p: Proposal, decision: Proposal['decision']) {
    setView(v => v && { ...v, proposals: v.proposals.map(x => x.id === p.id ? { ...x, decision } : x) });
    const res = await fetch(`/api/reviews/proposals/${p.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }) });
    if (!res.ok) { toast((await res.json()).error || '操作失败'); void load(); }
    refresh();
  }
  async function finish() {
    setBusy(true);
    try {
      const res = await fetch('/api/reviews/current/finish', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) { toast(body.error || '操作失败'); return; }
      toast(body.changed ? `已生成策略 v${body.strategyVersion}，开始第 ${body.roundNo} 轮` : `沿用当前策略，开始第 ${body.roundNo} 轮`);
      refresh();
      setTimeout(() => router.push('/overview'), 700);
    } finally { setBusy(false); }
  }
  function jump(seq: number) {
    document.getElementById(`prop-${seq}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlash(seq); setTimeout(() => setFlash(null), 1200);
  }

  const overallRate = st ? st.resumePass / Math.max(st.applied - st.pending, 1) : 0;
  const groupRows = (rows: Group[]) => rows.map(g => {
    const resolved = g.n - g.pending;
    const rate = resolved ? g.resumePass / resolved : 0;
    const few = g.n < 5;
    const bad = !few && resolved >= 3 && rate < overallRate * 0.6;
    return (
      <div key={g.key} className={`${s.gRow} ${bad ? s.bad : ''}`}>
        <span>{g.key}</span>
        <div className={`${s.gBar} ${few ? s.thin : ''}`}><i style={{ width: `${Math.round(rate * 100)}%` }} /></div>
        <span className={s.v}>投 {g.n} · 收到邀请 {g.resumePass}{g.pending ? ` · ${g.pending} 未回复` : ''}{few ? ' · 样本少' : ''}</span>
      </div>
    );
  });
  const funnel = st && [['已投递', st.applied], ['收到笔试 / 面试邀请', st.resumePass], ['收到面试', st.interview], ['Offer', st.offer]] as Array<[string, number]>;
  const biggestDrop = st && (st.applied - st.resumePass >= st.resumePass - st.interview ? '简历筛选' : '面试前');

  return (
    <div className={s.page}>
      {tabBar}
      <div className={s.noteBar}>
        第 {view.roundNo} 轮复盘 · 基于 {md(rv.createdSim)}的结果，使用策略 v{view.strategyVersion}。
        {st && st.pending > 0 && ` 还有 ${st.pending} 个投递在等待回复，不算失败，回复后计入下一次复盘。`}
      </div>
      {rv.status === 'failed' && <div className={s.ask}><p>本轮未能生成调整建议（{rv.error ?? 'AI 服务异常'}）。下面是统计结果，你可以沿用当前策略开始下一轮。</p></div>}

      {st && (
        <div className={s.sumRow}>
          <div className={`card ${s.kpi}`}><div className={s.l}>投递</div><div className={s.n}>{st.applied}</div><div className={s.d}>已回复 {st.withResult} · 未回复 {st.pending + st.noResponse}</div></div>
          <a href={`/progress?status=resume_reject&round=${view.roundNo}`} className={`card ${s.kpi}`} title="在投递进度中查看是哪些岗位"><div className={s.l}>未通过简历</div><div className={s.n}>{st.resumeReject}</div><div className={s.d}>明确收到拒绝 · 查看是哪些 ›</div></a>
          <div className={`card ${s.kpi}`}><div className={s.l}>收到笔试 / 测评</div><div className={s.n}>{st.examInvited}</div><div className={s.d}>{outcome(st.examPass, st.examFail, st.examPending)}</div></div>
          <div className={`card ${s.kpi}`}><div className={s.l}>收到面试</div><div className={s.n}>{st.interview}</div><div className={s.d}>{outcome(st.offer, st.interviewFail, st.interviewPending, '拿到 Offer')}</div></div>
          <div className={`card ${s.kpi}`}><div className={s.l}>未回复</div><div className={s.n}>{st.pending + st.noResponse}</div><div className={s.d}>{st.pending && st.noResponse ? `等待中 ${st.pending} · 超 7 天无回应 ${st.noResponse}` : st.noResponse ? '均已超 7 天，视为无回应' : '回复后计入下一次复盘'}</div></div>
        </div>
      )}

      {rv.findings.length > 0 && (
        <div className="card">
          <div className={s.cardH}><h3>本轮发现 · {rv.findings.length} 条</h3><span className={s.sub}>按重要程度排序</span></div>
          <div className={s.cardB} style={{ paddingTop: 8 }}>
            {rv.findings.map((f, i) => (
              <div key={i} className={s.finding}>
                <span className={`${s.ft} ${s[f.type]}`}>{FT[f.type]}</span>
                <div><b>{f.title}</b><p>{f.detail}</p></div>
                {f.proposals.length
                  ? <button className={s.fl} onClick={() => jump(f.proposals[0])}>对应建议 {f.proposals.map(n => NUM[n - 1] ?? n).join(' ')}</button>
                  : <button className={s.fl} disabled>{f.type === 'normal' ? '无需调整' : '暂无建议'}</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {rv.status !== 'failed' && (
        <div className="card">
          <div className={s.cardH}><h3>调整建议 · {view.proposals.length} 条</h3><span className={s.sub}>你确认后才会生效</span></div>
          <div className={`${s.cardB} ${s.props}`}>
            {!view.proposals.length && <p className="muted">本轮没有需要调整的地方，下一轮继续使用当前策略。</p>}
            {view.proposals.map(p => {
              const [yes, no] = labels(p);
              const strCls = p.kind === 'preference' ? s.you : p.weak ? s.low : s.high;
              return (
                <div key={p.id} id={`prop-${p.seq}`} className={`${s.prop} ${p.decision === 'accepted' ? s.accepted : p.decision === 'rejected' ? s.rejected : ''} ${flash === p.seq ? s.flash : ''}`}>
                  <div className={s.propH}><b>{NUM[p.seq - 1] ?? p.seq} {p.title}</b><span className={`${s.str} ${strCls}`}>{p.basisLabel}</span></div>
                  <div className={s.change}>调整内容：{p.changeText}</div>
                  {(p.evidence.bullets.length > 0 || p.evidence.cautions.length > 0) && (
                    <div className={s.evi}>
                      {p.evidence.bullets.length > 0 && <><div className={s.eviT}>证据</div><ul>{p.evidence.bullets.map((b, i) => <li key={i}>{rich(b)}</li>)}</ul></>}
                      {p.evidence.cautions.length > 0 && <><div className={s.eviT} style={{ marginTop: 8 }}>需要注意</div><ul>{p.evidence.cautions.map((b, i) => <li key={i}>{rich(b)}</li>)}</ul></>}
                    </div>
                  )}
                  {p.evidence.tip && <div className={s.tip}>{p.evidence.tip}</div>}
                  {p.notes.map((n, i) => <div key={i} className={s.tip} style={{ color: 'var(--muted)' }}>{n}</div>)}
                  <div className={s.propA}>
                    {p.decision === 'pending' && editable && <>
                      <button className="btn sm" onClick={() => void decide(p, 'rejected')}>{no}</button>
                      <button className="btn primary sm" onClick={() => void decide(p, 'accepted')}>{yes}</button>
                    </>}
                    {p.decision !== 'pending' && <>
                      <span className={`${s.decided} ${p.decision === 'rejected' ? s.grey : ''}`}>{p.decision === 'accepted' ? '✓ 已采纳' : `已选择：${no}`}</span>
                      {editable && <button className="link-btn" onClick={() => void decide(p, 'pending')}>撤销</button>}
                    </>}
                    {p.decision === 'pending' && !editable && <span className={`${s.decided} ${s.grey}`}>未处理</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {st && (
        <div className={s.grid2}>
          <div className="card">
            <div className={s.cardH}><h3>每个环节通过了多少</h3></div>
            <div className={`${s.cardB} ${s.funnel}`}>
              {funnel!.map(([label, n], i) => (
                <div key={label} className={`${s.fRow} ${i === 1 && biggestDrop === '简历筛选' ? s.bad : ''}`}>
                  <span>{label}</span><div className={s.fBar}><i style={{ width: `${st.applied ? (n / st.applied) * 100 : 0}%` }} /></div><span className={s.v}>{n}</span>
                </div>
              ))}
              <p className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.6 }}>
                流失最多的是<b style={{ color: 'var(--gate)' }}>{biggestDrop}</b>。{st.pending ? `还有 ${st.pending} 个投递在等待回复，会计入下一次复盘。` : ''}
              </p>
            </div>
          </div>
          <div className="card">
            <div className={s.cardH}><h3>各分组收到邀请的比例</h3></div>
            <div className={`${s.cardB} ${s.grp}`} style={{ paddingTop: 4 }}>
              <h4>按方向</h4>{groupRows(st.groups.direction)}
              <h4>按推荐档位</h4>{groupRows(st.groups.tier)}
              <h4>按城市</h4>{groupRows(st.groups.city)}
            </div>
          </div>
        </div>
      )}

      {editable && (
        <div className={s.actionbar}>
          <span className={s.note}>{pending ? `还有 ${pending} 条建议未处理` : view.proposals.length ? `已采纳 ${accepted} 条，${view.proposals.length - accepted} 条未采纳` : '本轮没有调整'}</span>
          <button className="btn primary" disabled={pending > 0 || busy} onClick={() => void finish()}>
            {accepted ? `生成策略 v${view.nextStrategyVersion} 并开始下一轮` : view.proposals.length || rv.status === 'failed' ? '沿用当前策略，开始下一轮' : '开始下一轮'}
          </button>
        </div>
      )}
      {toastNode}
    </div>
  );
}
