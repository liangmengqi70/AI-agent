import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { costSummary, experimentReport, internalAccess, roundEffect, visitorDetail, visitorList } from '@/services/internal-service';
import s from './internal.module.css';

// 内部评估页（不对用户开放）：成本、各轮结果、对照实验、访客的完整执行记录
export const dynamic = 'force-dynamic';

const TABS = [['cost', '大模型成本'], ['effect', '各轮结果'], ['experiment', '对照实验'], ['visitors', '访客记录']] as const;
type Tab = typeof TABS[number][0];
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const k = (x: number) => (x >= 10000 ? `${(x / 1000).toFixed(0)}k` : String(x));
const yuan = (x: number | null) => (x === null ? '—' : `¥${x.toFixed(2)}`);
const ACTOR: Record<string, [string, string]> = { code: ['程序', s.code], llm: ['大模型', s.llm], tool: ['工具', s.tool], user: ['你', s.user] };

export default async function InternalPage({ searchParams }: { searchParams: Promise<{ tab?: string; visitor?: string; key?: string }> }) {
  const q = await searchParams;
  if (!internalAccess(q.key)) notFound();
  const tab: Tab = (TABS.some(t => t[0] === q.tab) ? q.tab : 'cost') as Tab;
  const link = (params: Record<string, string>) => `/internal?${new URLSearchParams({ ...(q.key ? { key: q.key } : {}), ...params })}`;

  return (
    <div className={s.page}>
      <div className={s.head}><h1>内部评估</h1><span>只给开发者看，不对用户开放</span></div>
      <nav className={s.tabs}>{TABS.map(([id, name]) => <a key={id} href={link({ tab: id })} className={tab === id ? s.on : ''}>{name}</a>)}</nav>
      {tab === 'cost' && <Cost />}
      {tab === 'effect' && <Effect />}
      {tab === 'experiment' && <Experiment />}
      {tab === 'visitors' && (q.visitor ? <Visitor id={q.visitor} back={link({ tab: 'visitors' })} /> : <Visitors link={id => link({ tab: 'visitors', visitor: id })} />)}
    </div>
  );
}

async function Cost() {
  const c = await costSummary();
  return <>
    <div className={s.card}>
      <h2>每日上限</h2>
      <p className={s.note}>最近 24 小时调用 {c.quota.used24h} 次；全站上限 {c.quota.global || '不限'}，每个访客上限 {c.quota.visitor || '不限'}（环境变量 AI_DAILY_GLOBAL_CALLS / AI_DAILY_VISITOR_CALLS）。</p>
      {!c.priced && <p className={s.note}>未配置价格（LLM_PRICE_INPUT_PER_M / LLM_PRICE_OUTPUT_PER_M，元 / 百万 token），只显示 token 数。</p>}
    </div>
    <div className={s.card}>
      <h2>按环节（最近 30 天）</h2>
      <table className={s.table}><thead><tr><th>环节</th><th>模型</th><th className={s.num}>调用</th><th className={s.num}>成功率</th><th className={s.num}>输入 token</th><th className={s.num}>输出 token</th><th className={s.num}>平均耗时</th><th className={s.num}>费用</th></tr></thead>
        <tbody>{c.byTask.map(r => <tr key={r.task + r.model}><td>{r.task}</td><td>{r.model}</td><td className={s.num}>{r.calls}</td><td className={s.num}>{pct(r.ok, r.calls)}</td><td className={s.num}>{k(r.tin)}</td><td className={s.num}>{k(r.tout)}</td><td className={s.num}>{(r.ms / 1000).toFixed(1)}s</td><td className={s.num}>{yuan(r.cost)}</td></tr>)}</tbody></table>
    </div>
    <div className={s.card}>
      <h2>按日期</h2>
      <table className={s.table}><thead><tr><th>日期</th><th className={s.num}>调用</th><th className={s.num}>成功率</th><th className={s.num}>输入 token</th><th className={s.num}>输出 token</th><th className={s.num}>费用</th></tr></thead>
        <tbody>{c.byDay.map(r => <tr key={r.day}><td>{r.day}</td><td className={s.num}>{r.calls}</td><td className={s.num}>{pct(r.ok, r.calls)}</td><td className={s.num}>{k(r.tin)}</td><td className={s.num}>{k(r.tout)}</td><td className={s.num}>{yuan(r.cost)}</td></tr>)}</tbody></table>
    </div>
    <div className={s.card}>
      <h2>最近的失败</h2>
      {c.errors.length ? <table className={s.table}><thead><tr><th>时间</th><th>环节</th><th>原因</th><th className={s.num}>次数</th></tr></thead>
        <tbody>{c.errors.map((e, i) => <tr key={i}><td>{e.at}</td><td>{e.task}</td><td className={s.bad}>{e.error}</td><td className={s.num}>{String(e.times)}</td></tr>)}</tbody></table>
        : <p className={s.note}>没有失败记录。</p>}
    </div>
  </>;
}

async function Effect() {
  const rows = await roundEffect();
  return (
    <div className={s.card}>
      <h2>各轮投递结果（所有访客合计）</h2>
      <p className={s.note}>邀请率 = 收到笔试或面试邀请 / 已回复；面试率 = 收到面试 / 投递。包含对照实验产生的访客。</p>
      <table className={s.table}><thead><tr><th>轮次</th><th className={s.num}>访客</th><th className={s.num}>投递</th><th className={s.num}>已回复</th><th className={s.num}>收到邀请</th><th className={s.num}>邀请率</th><th className={s.num}>收到笔试</th><th className={s.num}>收到面试</th><th className={s.num}>面试率</th><th className={s.num}>Offer</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.roundNo}><td>第 {r.roundNo} 轮</td><td className={s.num}>{r.visitors}</td><td className={s.num}>{r.applied}</td><td className={s.num}>{r.replied}</td><td className={s.num}>{r.invited}</td><td className={s.num}>{pct(r.invited, r.replied)}</td><td className={s.num}>{r.exam}</td><td className={s.num}>{r.interview}</td><td className={s.num}>{pct(r.interview, r.applied)}</td><td className={s.num}>{r.offer}</td></tr>)}</tbody></table>
    </div>
  );
}

/** 极简 Markdown 渲染：标题、表格、列表、加粗（实验报告用） */
function Markdown({ text }: { text: string }) {
  const bold = (t: string): ReactNode[] => t.split(/(\*\*[^*]+\*\*)/g).map((x, i) => x.startsWith('**') ? <b key={i}>{x.slice(2, -2)}</b> : x);
  const out: ReactNode[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) { if (!/^\|[-| ]+\|$/.test(lines[i])) rows.push(lines[i].split('|').slice(1, -1).map(c => c.trim())); i++; }
      i--;
      out.push(<table key={i} className={s.table}><thead><tr>{rows[0].map((c, j) => <th key={j}>{c}</th>)}</tr></thead><tbody>{rows.slice(1).map((r, a) => <tr key={a}>{r.map((c, j) => <td key={j}>{bold(c)}</td>)}</tr>)}</tbody></table>);
    } else if (l.startsWith('# ')) out.push(<h1 key={i}>{l.slice(2)}</h1>);
    else if (l.startsWith('## ')) out.push(<h2 key={i}>{l.slice(3)}</h2>);
    else if (l.startsWith('- ')) out.push(<ul key={i}><li>{bold(l.slice(2))}</li></ul>);
    else if (l.trim()) out.push(<p key={i}>{bold(l)}</p>);
  }
  return <div className={s.md}>{out}</div>;
}

async function Experiment() {
  const md = await experimentReport();
  return (
    <div className={s.card}>
      {md ? <Markdown text={md} /> : <p className={s.note}>还没有实验报告。运行 npm run experiment（需先启动开发服务器）后生成 data/experiments/latest.md。</p>}
    </div>
  );
}

async function Visitors({ link }: { link: (id: string) => string }) {
  const rows = await visitorList();
  return (
    <div className={s.card}>
      <h2>最近的访客</h2>
      <table className={s.table}><thead><tr><th>编号</th><th>类型</th><th>创建</th><th>最近访问</th><th className={s.num}>轮次</th><th>当前状态</th><th className={s.num}>投递</th><th className={s.num}>大模型调用</th></tr></thead>
        <tbody>{rows.map(v => <tr key={v.id}><td><a href={link(v.id)}>{v.id}</a></td><td>{v.persona_key ?? (v.kind === 'demo' ? '演示' : '用户')}</td><td>{v.created}</td><td>{v.seen}</td><td className={s.num}>{String(v.rounds ?? 0)}</td><td>{v.status ?? '—'}</td><td className={s.num}>{String(v.apps)}</td><td className={s.num}>{String(v.calls)}</td></tr>)}</tbody></table>
    </div>
  );
}

async function Visitor({ id, back }: { id: string; back: string }) {
  const d = await visitorDetail(id);
  return <>
    <p className={s.note}><a href={back} style={{ textDecoration: 'underline' }}>‹ 返回访客列表</a> · 访客 {id}</p>
    <div className={s.card}>
      <h2>大模型调用</h2>
      <table className={s.table}><thead><tr><th>环节</th><th className={s.num}>调用</th><th className={s.num}>成功</th><th className={s.num}>输入 token</th><th className={s.num}>输出 token</th></tr></thead>
        <tbody>{d.calls.map(c => <tr key={c.task}><td>{c.task}</td><td className={s.num}>{c.calls}</td><td className={s.num}>{c.ok}</td><td className={s.num}>{k(c.tin)}</td><td className={s.num}>{k(c.tout)}</td></tr>)}</tbody></table>
    </div>
    <div className={s.card}>
      <h2>策略版本</h2>
      {d.strategies.map(v => <p key={v.version} className={s.note}><b>v{v.version}</b>（{v.source} · {v.created}）{(v.changes ?? []).map(c => `${c.accepted ? '✓' : '✗'} ${c.text}`).join('；') || '初始策略'}</p>)}
    </div>
    <div className={s.card}>
      <h2>每轮执行记录</h2>
      {d.rounds.map(r => (
        <div key={r.id} className={s.round}>
          <h3>第 {r.round_no} 轮 · {r.status} · 画像 v{r.profile_version} · 策略 v{r.strategy_version} · 开始 {r.started_sim}{r.applied_sim ? ` · 投递 ${r.applied_sim}` : ''}{r.error ? ` · 错误：${r.error}` : ''}</h3>
          <table className={s.table}><tbody>{r.steps.map(st => (
            <tr key={st.seq}><td style={{ width: 70 }}>{st.at}</td><td style={{ width: 60 }}><span className={`${s.actor} ${ACTOR[st.actor]?.[1] ?? ''}`}>{ACTOR[st.actor]?.[0] ?? st.actor}</span></td>
              <td><b>{st.title}</b>：{st.summary}{st.detail && <div className={s.detail}>{st.detail}</div>}</td></tr>
          ))}</tbody></table>
          {r.review && <>
            <h3>复盘工具调用（{(r.review.tools as unknown[]).length} 次）{r.review.error ? ` · 失败：${r.review.error}` : ''}</h3>
            <table className={s.table}><tbody>{(r.review.tools as Array<{ seq: number; tool: string; plain_text: string; args: unknown; result_summary: string }>).map(t => (
              <tr key={t.seq}><td style={{ width: 30 }}>{t.seq}</td><td><b>{t.plain_text}</b><div className={s.detail}>{t.tool} {JSON.stringify(t.args)}</div><div className={s.detail}>{t.result_summary.slice(0, 600)}{t.result_summary.length > 600 ? '…' : ''}</div></td></tr>
            ))}</tbody></table>
            <h3>建议与护栏</h3>
            <table className={s.table}><tbody>{(r.review.proposals as Array<{ seq: number; kind: string; title: string; basis_label: string; change_spec: unknown; guard_result: { notes?: string[] } | null; decision: string }>).map(p => (
              <tr key={p.seq}><td style={{ width: 30 }}>{p.seq}</td><td><b>{p.title}</b>（{p.kind} · {p.basis_label} · {p.decision}）<div className={s.detail}>{JSON.stringify(p.change_spec)}{p.guard_result?.notes?.length ? ` · 护栏：${p.guard_result.notes.join('；')}` : ''}</div></td></tr>
            ))}</tbody></table>
          </>}
        </div>
      ))}
    </div>
  </>;
}
