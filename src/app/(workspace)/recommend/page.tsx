'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRound } from '@/components/workspace/round-context';
import { Modal, useToast } from '@/components/common/ui';
import s from '../workspace.module.css';

// 推荐页：查看推荐与逐条依据，勾选 / 跳过，回答合并提问，确认投递
type Decision = 'selected' | 'skipped' | 'untouched';
type Item = {
  jobId: string; title: string; company: string; companyType: string; city: string; direction: string; jobType: string;
  salary: { min: number | null; max: number | null; unit: 'day' | 'month' }; daysPerWeek: number | null; months: number | null;
  deadline: string | null; tier: 'rec' | 'con'; isExplore: boolean; reason: string | null; risk: string | null;
  judgments: Array<{ req: string; kind: 'must' | 'bonus'; status: 'ok' | 'part' | 'no'; evidence: string }>;
  flags: string[]; keys: number[]; kind: string | null; decision: Decision; skipNote: string | null;
};
type Question = { id: string; key: string; answer: string | null; target: number | null; affected: number; shown: number; usual: number | null; max: number | null; label: string; unit: string };
type Data = {
  roundNo: number; status: string; simDate: string; items: Item[]; questions: Question[];
  limits: { roundApplyLimit: number; sameCompanyLimit: number };
  hidden: { filtered: number; reasons: Array<{ reason: string; n: number }> };
} | null;
type Conflict = { title: string; company: string; reason: string };

const TYPE_CN: Record<string, string> = { daily_intern: '日常实习', summer_intern: '暑期实习', campus: '校招' };
const ICON = { ok: '✓', part: '△', no: '✗' };
const QUICK = ['不想去这个城市', '对这家公司不感兴趣', '方向不是我想要的', '要求太高', '薪资太低'];
const pay = (x: Item['salary']) => x.min ? (x.unit === 'day' ? `${x.min}–${x.max} 元/天` : `${x.min}–${x.max}K/月`) : '薪资面议';
const cmp = (a: number[], b: number[]) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0); return 0; };
function dueText(deadline: string | null, simDate: string) {
  if (!deadline) return null;
  const d = Math.round((Date.parse(deadline) - Date.parse(simDate)) / 86_400_000);
  return d <= 7 ? `${d} 天后截止` : null;
}
async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || '操作失败，请重试');
  return json;
}

export default function RecommendPage() {
  const router = useRouter();
  const { data: round, refresh } = useRound();
  const { toast, toastNode } = useToast();
  const [data, setData] = useState<Data>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [openHidden, setOpenHidden] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipText, setSkipText] = useState('');
  const [answered, setAnswered] = useState<string | null>(null);
  const [modal, setModal] = useState<'confirm' | { conflicts: Conflict[]; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const skipInput = useRef<HTMLInputElement>(null);
  const status = round?.round.status;

  const load = useCallback(() => fetch('/api/recommendations').then(r => r.json()).then((d: Data) => {
    setData(d);
    if (d?.items.length) setSel(cur => cur && d.items.some(i => i.jobId === cur) ? cur : [...d.items].sort((a, b) => (a.tier === b.tier ? cmp(a.keys, b.keys) : a.tier === 'rec' ? -1 : 1))[0].jobId);
  }), []);
  useEffect(() => { if (status && status !== 'generating') void load(); }, [status, load]);
  useEffect(() => { setSkipOpen(false); setSkipText(''); }, [sel]);

  if (status === 'generating') return <div className={s.page}><div className={`card ${s.state}`}><b>正在生成第 {round!.round.no} 轮推荐</b>Agent 正在拉取岗位、过滤并逐条分析，大约需要 1–2 分钟。<br />你可以先离开，完成后会出现在这里。</div></div>;
  if (!data) return <div className={s.page}><div className={`card ${s.state}`}>正在读取…</div></div>;
  if (!data.items.length) return (
    <div className={s.page}><div className={`card ${s.state}`}><b>这一轮没有找到合适的岗位</b>可能是方向、城市或求职类型的范围比较窄。可以放宽偏好后重新生成。<br /><a className="btn primary" href="/confirm?mode=edit" style={{ marginTop: 14 }}>去修改偏好</a></div></div>
  );

  const editable = data.status === 'awaiting_apply';
  const groups: Array<['rec' | 'con', string]> = [['rec', '推荐（稳妥）'], ['con', '可以考虑（探索）']];
  const sorted = (t: 'rec' | 'con') => data.items.filter(i => i.tier === t).sort((a, b) => cmp(a.keys, b.keys));
  const cur = data.items.find(i => i.jobId === sel) ?? data.items[0];
  const tierTag = (t: 'rec' | 'con') => t === 'rec' ? <span className="tag rec">推荐</span> : <span className="tag con">可以考虑 · 探索</span>;
  const hiddenTotal = data.hidden.reasons.reduce((n, r) => n + r.n, 0);
  const picked = data.items.filter(i => i.decision === 'selected');
  const skipped = data.items.filter(i => i.decision === 'skipped');
  const question = editable ? data.questions.find(q => !q.answer) : undefined;

  // 本地先更新，再提交到服务端；失败时重新读取
  async function decide(jobIds: string[], decision: Decision, note?: string) {
    setData(d => d && { ...d, items: d.items.map(i => jobIds.includes(i.jobId) ? { ...i, decision, skipNote: decision === 'skipped' ? note || null : null } : i) });
    try {
      await post('/api/recommendations/decision', { jobIds, decision, skipNote: note, skipQuick: note ? QUICK.filter(q => note.includes(q)) : undefined });
    } catch (e) { toast((e as Error).message); void load(); }
  }
  function doSkip(note: string) {
    void decide([cur.jobId], 'skipped', note);
    setSkipOpen(false); setSkipText('');
    toast(note ? '已跳过，你的说明会在复盘时参考' : '已跳过');
  }
  async function answer(q: Question, a: 'accept' | 'reject' | 'keep_only') {
    setBusy(true);
    try { const r = await post(`/api/questions/${q.id}/answer`, { answer: a }); setAnswered(r.message); await load(); refresh(); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }
  async function apply() {
    setModal(null); setBusy(true);
    try {
      const r = await post('/api/rounds/current/apply', {});
      if (!r.ok) { setModal({ conflicts: r.conflicts, message: r.message }); return; }
      toast(`已投递 ${r.applied} 个岗位`);
      refresh();
      setTimeout(() => router.push('/progress'), 600);
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }

  const qText = (q: Question) => q.key === 'daysPerWeek' ? `每周到岗 ${q.target} 天` : `实习 ${q.target} 个月`;

  return (
    <div className={s.page}>
      {!editable && (
        <div className={`card ${s.state}`} style={{ padding: '28px 24px' }}>
          <b>第 {data.roundNo} 轮已投递 {picked.length} 个 · 跳过 {skipped.length} 个</b>
          投递结果会陆续出现在投递进度页。下一轮推荐会在复盘完成后生成。<br />
          <a className="btn" href="/progress" style={{ marginTop: 12 }}>查看投递进度 ›</a>
        </div>
      )}
      {question && (
        <div className={s.ask}>
          <p>本轮有 <b>{question.affected} 个岗位</b>要求{qText(question)}，你填的是"通常 {question.usual ?? '—'} {question.unit}，最多 {question.max ?? '—'} {question.unit}"。
            {question.shown > 0 && <>其中技术匹配较好的 {question.shown} 个已放进"可以考虑"。</>}<br />你能接受{qText(question)}吗？</p>
          <div className="btns" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" disabled={busy} onClick={() => answer(question, 'accept')}>可以，更新偏好</button>
            <button className="btn" disabled={busy} onClick={() => answer(question, 'reject')}>不行</button>
            {question.shown > 0 && <button className="btn" disabled={busy} onClick={() => answer(question, 'keep_only')}>只看这 {question.shown} 个</button>}
          </div>
        </div>
      )}
      {!question && answered && <div className={s.ask}><p>✓ {answered}</p></div>}

      <div className={s.recArea}>
        <div className="card">
          <div className={s.listHead}>
            {editable && <input type="checkbox" aria-label="全选" checked={picked.length === data.items.length}
              onChange={e => void decide(data.items.map(i => i.jobId), e.target.checked ? 'selected' : 'untouched')} />}
            <span>推荐 {sorted('rec').length} · 可以考虑 {sorted('con').length}</span>
          </div>
          {groups.map(([t, name]) => (
            <div key={t}>
              <div className={s.groupTitle}>{name}</div>
              {!sorted(t).length && (
                <div className={s.filtered}>{t === 'rec' ? '这一轮没有完全达到"推荐"标准的岗位，可以看看下面"可以考虑"的岗位。' : '这一轮没有"可以考虑"的岗位。'}</div>
              )}
              {sorted(t).map(j => (
                <div key={j.jobId} className={`${s.item} ${cur.jobId === j.jobId ? s.on : ''} ${j.decision === 'skipped' ? s.skipped : ''}`} onClick={() => setSel(j.jobId)}>
                  {editable && <input type="checkbox" checked={j.decision === 'selected'} onClick={e => e.stopPropagation()}
                    onChange={e => void decide([j.jobId], e.target.checked ? 'selected' : 'untouched')} />}
                  <div>
                    <div className={s.t}>{j.title}</div>
                    <div className={s.m}>{j.company} · {j.city} · {pay(j.salary)}</div>
                    <div className={s.tags}>
                      {tierTag(j.tier)}
                      {dueText(j.deadline, data.simDate) && <span className={`tag ${s.due}`}>{dueText(j.deadline, data.simDate)}</span>}
                      {j.flags.map(f => <span key={f} className="tag plain">{f}</span>)}
                      {j.decision === 'skipped' && <span className="tag plain">已跳过</span>}
                      {!editable && j.decision === 'selected' && <span className="tag plain">已投递</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {hiddenTotal > 0 && <button className={s.folded} onClick={() => setOpenHidden(o => !o)}>已筛掉 {hiddenTotal} 个岗位，查看原因 ›</button>}
          {openHidden && (
            <div className={s.filtered}>
              {data.hidden.reasons.map(r => <div key={r.reason}>{r.reason} · {r.n} 个</div>)}
              <div style={{ opacity: .7 }}>另有 {data.hidden.filtered} 个岗位因求职类型、城市、届别、方向、截止日期不符，在硬过滤阶段排除</div>
            </div>
          )}
        </div>

        <div className={`card ${s.detail}`}>
          <div className={s.dHead}>
            <div>
              <h2>{cur.title}</h2>
              <div className={s.m}>{cur.company} · {cur.city} · {TYPE_CN[cur.jobType]} · {pay(cur.salary)}{cur.daysPerWeek ? ` · 每周 ${cur.daysPerWeek} 天` : ''}{cur.months ? ` · ${cur.months} 个月` : ''}</div>
            </div>
            {tierTag(cur.tier)}
          </div>
          <div className={s.reason}>{cur.reason}</div>
          <div className={s.sec}>
            <h3>岗位要求逐条对照</h3>
            {cur.judgments.map((j, i) => (
              <div key={i} className={s.req}>
                <div className={`${s.ri} ${s[j.status]}`}>{ICON[j.status]}</div>
                <div>{j.req}<span className={s.kind}>{j.kind === 'must' ? '必须项' : '加分项'}</span></div>
                <div className={s.ev}>{j.evidence}</div>
              </div>
            ))}
          </div>
          {cur.risk && <div className={s.sec}><h3>需要注意</h3><div className={s.risk}>{cur.risk}</div></div>}

          {editable && (
            <div className={s.dActions}>
              <button className={s.resumeLink} onClick={() => toast('即将开放：将带上此岗位 JD 跳转到 ResumeIQ')}>去 ResumeIQ 针对此岗位优化简历 ›</button>
              <button className="btn" onClick={() => cur.decision === 'skipped' ? void decide([cur.jobId], 'untouched') : setSkipOpen(o => !o)}>
                {cur.decision === 'skipped' ? '取消跳过' : '跳过'}
              </button>
              <button className="btn primary" onClick={() => void decide([cur.jobId], cur.decision === 'selected' ? 'untouched' : 'selected')}>
                {cur.decision === 'selected' ? '已加入投递 ✓' : '加入投递'}
              </button>
            </div>
          )}
          {cur.decision === 'skipped' ? (
            <div className={s.skipchat}>
              <div className={`${s.bubble} ${s.me}`}>{cur.skipNote || '（没有说明原因）'}</div>
              <div className={`${s.bubble} ${s.agent}`}>已跳过这个岗位。{cur.skipNote ? '你的说明已记下，本轮复盘时会参考，用来调整之后的推荐。' : ''}</div>
            </div>
          ) : editable && skipOpen && (
            <div className={s.skipchat}>
              <div className={`${s.bubble} ${s.agent}`}>能说说为什么跳过这个岗位吗？你的说明会在复盘时帮助我调整之后的推荐。</div>
              <div className={s.quick}>
                {QUICK.map(r => <button key={r} className={s.chip} onClick={() => {
                  // 快捷原因填进输入框，光标放到末尾，方便继续补充
                  setSkipText(t => t ? `${t}；${r}` : r);
                  requestAnimationFrame(() => { const el = skipInput.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
                }}>{r}</button>)}
              </div>
              <div className={s.chatInput}>
                <input ref={skipInput} autoFocus value={skipText} placeholder="说说原因，例如：这家公司我之前面过，体验不太好"
                  onChange={e => setSkipText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doSkip(skipText.trim()); }} />
                <button className="btn primary sm" onClick={() => doSkip(skipText.trim())}>确认跳过</button>
              </div>
              <button className={s.undo} onClick={() => doSkip('')}>不说明，直接跳过</button>
            </div>
          )}
        </div>
      </div>

      {editable && (
        <div className={s.actionbar}>
          <span className={s.note}>同公司每季限投 {data.limits.sameCompanyLimit} 个 · 本轮上限 {data.limits.roundApplyLimit} 个</span>
          <button className="btn primary" disabled={!picked.length || busy} onClick={() => setModal('confirm')}>确认投递 {picked.length} 个</button>
        </div>
      )}
      {modal === 'confirm' && (
        <Modal title={`确认投递 ${picked.length} 个岗位？`} okText="确认投递" onOk={() => void apply()} onCancel={() => setModal(null)}>
          推荐 {picked.filter(i => i.tier === 'rec').length} 个、可以考虑 {picked.filter(i => i.tier === 'con').length} 个。<br />投递后不能撤回。
        </Modal>
      )}
      {modal && modal !== 'confirm' && (
        <Modal title="还不能投递" okText="知道了" onOk={() => setModal(null)} onCancel={() => setModal(null)}>
          {modal.message}
          {modal.conflicts.length > 0 && <span className={s.conflicts} style={{ display: 'block' }}>
            {modal.conflicts.map(c => <span key={c.title + c.company} style={{ display: 'block' }}>· {c.title}（{c.company}）：{c.reason}</span>)}
          </span>}
        </Modal>
      )}
      {toastNode}
    </div>
  );
}
