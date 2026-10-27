'use client';
// 确认页用到的表单小组件：字段行、标签编辑、分段选择、城市分组、经历列表
import { useEffect, useState, type ReactNode } from 'react';
import type { Experience, FieldSource } from '@/domain/profile';
import s from '@/app/confirm/confirm.module.css';

const SOURCE_LABEL: Record<FieldSource | 'confirmed', string> = {
  resume: '来自简历', ai: 'AI 推测', missing: '待补充', user: '你填写', supplement: '来自补充', default: '默认', confirmed: '已确认',
};

export function FieldRow({ id, label, source, hint, error, children }: {
  id?: string; label: string; source?: FieldSource | 'confirmed'; hint?: string; error?: string; children: ReactNode;
}) {
  return (
    <div className={`${s.field} ${error ? s.err : ''}`} id={id}>
      <label>{label}</label>
      <div className={s.val}>{children}</div>
      {source ? <span className={`src ${source}`}>{SOURCE_LABEL[source]}</span> : <span />}
      {(error || hint) && <div className={s.hint}>{error || hint}</div>}
    </div>
  );
}

/** 标签列表：可删除；options 为空时用输入框添加，否则用下拉选择 */
export function TagEditor({ items, onChange, options, placeholder = '+ 添加' }: {
  items: string[]; onChange: (next: string[]) => void; options?: readonly string[]; placeholder?: string;
}) {
  const [text, setText] = useState('');
  const add = (v: string) => { const t = v.trim(); if (t && !items.includes(t)) onChange([...items, t]); };
  return (
    <>
      {items.map(it => (
        <span key={it} className={s.tok}>{it}<button type="button" aria-label={`移除${it}`} onClick={() => onChange(items.filter(x => x !== it))}>×</button></span>
      ))}
      {options ? (
        <select className={s.addSel} value="" onChange={e => { add(e.target.value); }}>
          <option value="">{placeholder}</option>
          {options.filter(o => !items.includes(o)).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input className={s.addInp} placeholder={placeholder} value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(text); setText(''); } }}
          onBlur={() => { if (text.trim()) { add(text); setText(''); } }} />
      )}
    </>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T | null; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className={s.seg}>
      {options.map(([v, label]) => (
        <button key={v} type="button" className={value === v ? s.on : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

/** 城市：首选 / 可接受 / 不考虑，同一城市只能在一个分组里 */
export function CityGroups({ value, options, onChange }: {
  value: { preferred: string[]; acceptable: string[]; excluded: string[]; remoteOk: boolean; anyCity: boolean };
  options: readonly string[];
  onChange: (next: typeof value) => void;
}) {
  const groups = [['preferred', '首选'], ['acceptable', '可接受'], ['excluded', '不考虑']] as const;
  const set = (key: typeof groups[number][0], list: string[]) => {
    const next = { ...value, [key]: list };
    // 新加入的城市从其他分组里移除
    for (const [k] of groups) if (k !== key) next[k] = next[k].filter(c => !list.includes(c) || value[key].includes(c));
    onChange(next);
  };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {groups.map(([key, label]) => (
        <div key={key} className={s.val}>
          <span className={s.lv}>{label}</span>
          <TagEditor items={value[key]} options={options} onChange={list => set(key, list)} placeholder="+ 选择城市" />
        </div>
      ))}
      <div className={s.val} style={{ fontSize: 13 }}>
        <label><input type="checkbox" checked={value.remoteOk} onChange={e => onChange({ ...value, remoteOk: e.target.checked })} /> 接受远程</label>
        <label><input type="checkbox" checked={value.anyCity} onChange={e => onChange({ ...value, anyCity: e.target.checked })} /> 城市不限</label>
      </div>
    </div>
  );
}

export function Experiences({ items, onChange }: { items: Experience[]; onChange: (next: Experience[]) => void }) {
  const update = (i: number, patch: Partial<Experience>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className={s.exp}>
      {items.map((x, i) => (
        <div key={i} className={s.expItem}>
          <div className={s.expRow}>
            <select className={s.inp} value={x.kind} onChange={e => update(i, { kind: e.target.value as Experience['kind'] })}>
              <option value="internship">实习</option><option value="project">项目</option>
            </select>
            <input className={`${s.inp} ${s.w220}`} value={x.title} placeholder="名称" onChange={e => update(i, { title: e.target.value })} />
            <input className={s.inp} style={{ width: 120 }} value={x.role} placeholder="角色" onChange={e => update(i, { role: e.target.value })} />
            <input className={s.inp} style={{ width: 150 }} value={x.period} placeholder="时间" onChange={e => update(i, { period: e.target.value })} />
            <button type="button" className="link-btn" onClick={() => onChange(items.filter((_, j) => j !== i))}>删除</button>
          </div>
          <textarea value={x.detail} placeholder="做了什么" onChange={e => update(i, { detail: e.target.value })} />
        </div>
      ))}
      <div><button type="button" className="btn sm" onClick={() => onChange([...items, { kind: 'project', title: '', role: '', period: '', detail: '', tech: [] }])}>+ 添加经历</button></div>
    </div>
  );
}

/** 薪资底线：默认"不限"；可设定底线，并显示按方向和城市统计的市场参考 */
export function SalaryField({ value, onChange, unit, directions, cities }: {
  value: number | null; onChange: (v: number | null) => void; unit: 'day' | 'month'; directions: string[]; cities: string[];
}) {
  const [custom, setCustom] = useState(value !== null);
  const [ref, setRef] = useState<{ p25: number; median: number; p75: number; scope: string } | null>(null);
  const key = `${unit}|${directions.join(',')}|${cities.join(',')}`;
  useEffect(() => {
    const t = setTimeout(() => {
      const q = new URLSearchParams({ unit, directions: directions.join(','), cities: cities.join(',') });
      fetch(`/api/market/salary?${q}`).then(r => r.json()).then(setRef).catch(() => setRef(null));
    }, 400);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const u = unit === 'day' ? '元 / 天' : '千元 / 月';
  const word = unit === 'day' ? '日薪' : '月薪';
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className={s.val}>
        <Seg value={custom ? 'set' : 'any'} options={[['any', '不限'], ['set', '设定底线']]}
          onChange={v => { setCustom(v === 'set'); if (v === 'any') onChange(null); else if (ref) onChange(ref.p25); }} />
        {custom && <><Num value={value} onChange={onChange} /> {u}</>}
      </div>
      {ref && (
        <span className="muted" style={{ fontSize: 12 }}>
          参考：{ref.scope}的{unit === 'day' ? '实习' : '校招'}{word}大多在 {ref.p25}–{ref.p75} {u.split(' / ')[0]}，中位数 {ref.median}
        </span>
      )}
    </div>
  );
}

export function Num({ value, onChange, width }: { value: number | null; onChange: (v: number | null) => void; width?: number }) {
  return (
    <input className={`${s.inp} ${s.w60}`} style={width ? { width } : undefined} type="number" placeholder="—"
      value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />
  );
}
