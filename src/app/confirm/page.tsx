'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EntryHeader, Modal, Steps, useToast } from '@/components/common/ui';
import { CityGroups, Experiences, FieldRow, Num, SalaryField, Seg, TagEditor } from '@/components/confirm/fields';
import { CITIES, DEGREES, DIRECTIONS, type FieldKey, type FieldSources, type ProfileData } from '@/domain/profile';
import s from './confirm.module.css';

/** 把方向放进某一组时，从其他组（含延伸、不考虑）中移除 */
function setDirectionGroup(d: ProfileData, key: 'preferred' | 'acceptable', list: string[]) {
  const dir = d.prefs.directions;
  dir[key] = list;
  const other = key === 'preferred' ? 'acceptable' : 'preferred';
  dir[other] = dir[other].filter(x => !list.includes(x));
  dir.extended = dir.extended.filter(x => !list.includes(x));
  dir.excluded = dir.excluded.filter(x => !list.includes(x));
}

type Loaded = { version: number; data: ProfileData; sources: FieldSources; supplement: string; isEdit: boolean; filled: number; toConfirm: number; missing: number };

export default function ConfirmPage() {
  return <Suspense fallback={null}><ConfirmInner /></Suspense>;
}

function ConfirmInner() {
  const router = useRouter();
  const edit = useSearchParams().get('mode') === 'edit';
  const { toast, toastNode } = useToast();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState('');
  const [data, setData] = useState<ProfileData | null>(null);
  const [sources, setSources] = useState<FieldSources>({});
  const [supplement, setSupplement] = useState('');
  const [parsedLines, setParsedLines] = useState<string[] | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [savedAt, setSavedAt] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = useRef(false);
  const [touched, setTouched] = useState<Set<FieldKey>>(new Set());  // 本次修改过的字段
  const [round, setRound] = useState<{ no: number; status: string } | null>(null); // 修改模式：当前轮次，决定修改用于哪一轮
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    fetch(`/api/profile${edit ? '?mode=edit' : ''}`).then(async r => {
      const body = await r.json();
      if (!r.ok) { setLoadError(body.error || '读取失败'); return; }
      setLoaded(body); setData(body.data); setSources(body.sources); setSupplement(body.supplement ?? '');
    }).catch(() => setLoadError('网络或服务异常，请稍后重试'));
  }, [edit]);

  useEffect(() => {
    if (edit) fetch('/api/rounds/current').then(r => r.json()).then(d => setRound(d ? { no: d.round.no, status: d.round.status } : null)).catch(() => {});
  }, [edit]);
  const regenerates = round && (round.status === 'awaiting_apply' || round.status === 'failed');
  const generating = round?.status === 'generating';

  // 修改模式：保存前先说明这次修改用于哪一轮（有补充文字待解析时，先解析）
  function onSave() {
    if (edit && round && !(supplement.trim() && parsedLines === null)) setAsk(true);
    else void submit();
  }

  // 修改字段：更新数据，并把来源标记为"你填写"
  const update = useCallback((key: FieldKey, fn: (d: ProfileData) => void) => {
    setData(prev => { if (!prev) return prev; const next = structuredClone(prev); fn(next); return next; });
    setSources(prev => ({ ...prev, [key]: { source: 'user' } }));
    setTouched(prev => new Set(prev).add(key));
    setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
    dirty.current = true;
  }, []);

  // 自动保存草稿（停止输入 0.8 秒后）
  useEffect(() => {
    if (!loaded || !data || !dirty.current) return;
    const t = setTimeout(async () => {
      const res = await fetch('/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: loaded.version, data, sources, supplement }) });
      if (res.ok) setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    }, 800);
    return () => clearTimeout(t);
  }, [data, sources, supplement, loaded]);

  async function submit() {
    setAsk(false);
    if (!loaded || !data) return;
    setBusy(true);
    try {
      const res = await fetch('/api/profile/confirm', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: loaded.version, data, sources, supplement, supplementParsed: parsedLines !== null }),
      });
      const body = await res.json();
      if (!res.ok) { toast(body.error || '保存失败，请重试'); return; }
      if (body.status === 'invalid') {
        setErrors(body.errors);
        toast('还有必填项没有补充');
        const first = Object.keys(body.errors)[0];
        document.getElementById(`f-${first}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (body.status === 'parsed') {
        setData(body.data); setSources(body.sources); setParsedLines(body.lines);
        toast('已解析补充内容，请确认');
        return;
      }
      toast(body.effect === 'regenerated' ? `已保存，正在重新生成第 ${body.roundNo} 轮推荐`
        : body.effect === 'next_round' ? `已保存为画像 v${body.version}，将用于第 ${body.roundNo} 轮推荐` : edit ? `已保存为画像 v${body.version}` : '已保存画像 v1 与策略 v1');
      setTimeout(() => router.push('/overview'), 800);
    } catch {
      toast('网络或服务异常，请稍后重试');
    } finally {
      setBusy(false);
    }
  }

  const header = <EntryHeader onLogin={() => toast('第二版开放：使用 ResumeIQ 账号登录，保存进度')} />;
  if (loadError) return <div className={s.page}>{header}<div className={s.loading}>{loadError}<br /><br /><a className="btn" href="/upload">去上传简历</a></div>{toastNode}</div>;
  if (!loaded || !data) return <div className={s.page}>{header}<div className={s.loading}>正在读取…</div></div>;

  // 修改模式下，没动过的字段显示"已确认"
  const src = (k: FieldKey) => (edit && !touched.has(k) && sources[k]?.source === 'user' ? 'confirmed' as const : sources[k]?.source);
  const err = (k: FieldKey) => errors[k];
  const p = data.prefs;
  const intern = p.jobType === 'intern' || p.jobType === 'both';
  const campus = p.jobType === 'campus' || p.jobType === 'both';

  return (
    <div className={s.page}>
      {header}
      {!edit && <Steps current={2} />}
      <div className={s.main}>
        <h1>{edit ? '修改画像与偏好' : '确认你的画像与求职偏好'}</h1>
        <div className={s.summary}>
          {edit
            ? generating ? <b className={s.m}>Agent 正在生成第 {round!.no} 轮推荐，完成后再保存修改。</b>
              : regenerates ? <>第 {round!.no} 轮还没有确认投递，保存后将用新的画像重新生成第 {round!.no} 轮推荐。</>
              : round ? <>第 {round.no} 轮已经投递，此次修改将用于第 {round.no + 1} 轮推荐。</> : <>当前修改的是画像 v{loaded.version}，保存后生效。</>
            : <>已整理出 {loaded.filled} 项信息，<b className={s.c}>{loaded.toConfirm} 项需要你确认</b>，<b className={s.m}>{loaded.missing} 项待补充</b>。</>}
        </div>

        <div className={`card ${s.sec}`}>
          <h3>画像</h3><p className={s.d}>从简历中提取，可以直接修改</p>
          <FieldRow id="f-basics.school" label="学校 / 学历" source={src('basics.school')} error={err('basics.school') || err('basics.degree')}>
            <input className={`${s.inp} ${s.w220}`} value={data.basics.school ?? ''} placeholder="学校" onChange={e => update('basics.school', d => { d.basics.school = e.target.value; })} />
            <select className={s.inp} value={data.basics.degree ?? ''} onChange={e => update('basics.degree', d => { d.basics.degree = (e.target.value || null) as ProfileData['basics']['degree']; })}>
              <option value="">学历</option>{DEGREES.map(x => <option key={x}>{x}</option>)}
            </select>
          </FieldRow>
          <FieldRow id="f-basics.major" label="专业" source={src('basics.major')} error={err('basics.major')}>
            <input className={`${s.inp} ${s.w220}`} value={data.basics.major ?? ''} onChange={e => update('basics.major', d => { d.basics.major = e.target.value; })} />
          </FieldRow>
          <FieldRow id="f-basics.gradYear" label="毕业届别" source={src('basics.gradYear')} error={err('basics.gradYear')}>
            <Num value={data.basics.gradYear} width={90} onChange={v => update('basics.gradYear', d => { d.basics.gradYear = v; })} /> 届
          </FieldRow>
          <FieldRow id="f-skills" label="技能" source={src('skills')} error={err('skills')}>
            <TagEditor items={data.skills} onChange={list => update('skills', d => { d.skills = list; })} placeholder="+ 添加技能" />
          </FieldRow>
          <FieldRow id="f-courses" label="主修课程" source={src('courses')}>
            <TagEditor items={data.courses} onChange={list => update('courses', d => { d.courses = list; })} placeholder="+ 添加课程" />
          </FieldRow>
          <FieldRow id="f-experiences" label="项目 / 实习" source={src('experiences')} error={err('experiences')}>
            <Experiences items={data.experiences} onChange={list => update('experiences', d => { d.experiences = list; })} />
          </FieldRow>
          <FieldRow id="f-awards" label="竞赛 / 证书" source={src('awards')}>
            <TagEditor items={data.awards} onChange={list => update('awards', d => { d.awards = list; })} placeholder="+ 添加" />
          </FieldRow>
        </div>

        <div className={`card ${s.sec}`}>
          <h3>求职偏好</h3><p className={s.d}>简历里通常没有这些信息，AI 推测的部分请逐项确认</p>
          <FieldRow id="f-prefs.jobType" label="求职类型" source={src('prefs.jobType')} error={err('prefs.jobType')}>
            <Seg value={p.jobType} options={[['intern', '实习'], ['campus', '校招'], ['both', '都看']]} onChange={v => update('prefs.jobType', d => { d.prefs.jobType = v; })} />
            {intern && (['daily', 'summer'] as const).map(k => (
              <label key={k} style={{ fontSize: 13 }}>
                <input type="checkbox" checked={p.internKinds.includes(k)} onChange={e => update('prefs.jobType', d => {
                  d.prefs.internKinds = e.target.checked ? [...d.prefs.internKinds, k] : d.prefs.internKinds.filter(x => x !== k);
                })} /> {k === 'daily' ? '日常实习' : '暑期实习'}
              </label>
            ))}
          </FieldRow>
          <FieldRow id="f-prefs.directions" label="目标方向" source={src('prefs.directions')} error={err('prefs.directions')}>
            <div style={{ display: 'grid', gap: 8 }}>
              <div className={s.val}><span className={s.lv}>首选</span>
                <TagEditor items={p.directions.preferred} options={DIRECTIONS} placeholder="+ 选择方向" onChange={list => update('prefs.directions', d => { setDirectionGroup(d, 'preferred', list); })} />
              </div>
              <div className={s.val}><span className={s.lv}>可接受</span>
                <TagEditor items={p.directions.acceptable} options={DIRECTIONS} placeholder="+ 选择方向" onChange={list => update('prefs.directions', d => { setDirectionGroup(d, 'acceptable', list); })} />
              </div>
              {p.directions.extended.length > 0 && (
                <div className={s.val}><span className={s.lv}>延伸</span>
                  {p.directions.extended.map(x => (
                    <span key={x} className={s.tok} style={{ borderStyle: 'dashed' }}>{x}
                      <button type="button" aria-label={`不考虑${x}`} onClick={() => update('prefs.directions', d => {
                        d.prefs.directions.extended = d.prefs.directions.extended.filter(y => y !== x);
                        d.prefs.directions.excluded = [...d.prefs.directions.excluded, x];
                      })}>×</button>
                    </span>
                  ))}
                  <span className="muted" style={{ fontSize: 12 }}>AI 根据你的技能推测，删除后不再推荐</span>
                </div>
              )}
            </div>
          </FieldRow>
          <FieldRow id="f-prefs.cities" label="意向城市" source={src('prefs.cities')} error={err('prefs.cities')}>
            <CityGroups value={p.cities} options={CITIES} onChange={v => update('prefs.cities', d => { d.prefs.cities = v; })} />
          </FieldRow>
          {intern && (
            <FieldRow id="f-prefs.internPayMin" label="实习薪资底线" source={src('prefs.internPayMin')} error={err('prefs.internPayMin')} hint="选填。不限时不按薪资筛选，推荐中仍会显示每个岗位的薪资">
              <SalaryField unit="day" value={p.internPayMin} directions={[...p.directions.preferred, ...p.directions.acceptable]} cities={[...p.cities.preferred, ...p.cities.acceptable]} onChange={v => update('prefs.internPayMin', d => { d.prefs.internPayMin = v; })} />
            </FieldRow>
          )}
          {campus && (
            <FieldRow id="f-prefs.campusPayMin" label="校招薪资底线" source={src('prefs.campusPayMin')} error={err('prefs.campusPayMin')} hint="选填。不限时不按薪资筛选">
              <SalaryField unit="month" value={p.campusPayMin} directions={[...p.directions.preferred, ...p.directions.acceptable]} cities={[...p.cities.preferred, ...p.cities.acceptable]} onChange={v => update('prefs.campusPayMin', d => { d.prefs.campusPayMin = v; })} />
            </FieldRow>
          )}
          {intern && (
            <FieldRow id="f-prefs.daysPerWeek" label="每周到岗" source={src('prefs.daysPerWeek')} error={err('prefs.daysPerWeek')}
              hint={'不确定的话，"最多"可以填宽一点，Agent 会把超出"通常"的岗位放进"可以考虑"并提示'}>
              通常 <Num value={p.daysPerWeek.usual} onChange={v => update('prefs.daysPerWeek', d => { d.prefs.daysPerWeek.usual = v; })} /> 天，最多可调整到
              <Num value={p.daysPerWeek.max} onChange={v => update('prefs.daysPerWeek', d => { d.prefs.daysPerWeek.max = v; })} /> 天
            </FieldRow>
          )}
          {intern && (
            <FieldRow id="f-prefs.months" label="实习时长" source={src('prefs.months')} error={err('prefs.months')}>
              通常 <Num value={p.months.usual} onChange={v => update('prefs.months', d => { d.prefs.months.usual = v; })} /> 个月，最多可延长到
              <Num value={p.months.max} onChange={v => update('prefs.months', d => { d.prefs.months.max = v; })} /> 个月
            </FieldRow>
          )}
          <FieldRow id="f-prefs.valueConversion" label="看重转正机会" source={src('prefs.valueConversion')}>
            <Seg value={p.valueConversion ? 'y' : 'n'} options={[['y', '是'], ['n', '否']]} onChange={v => update('prefs.valueConversion', d => { d.prefs.valueConversion = v === 'y'; })} />
          </FieldRow>
        </div>

        <div className={`card ${s.sec}`}>
          <h3>还想让 Agent 知道的（选填）</h3>
          <p className={s.d}>用你自己的话写，Agent 只会解析这里补充的内容，不会改动上面你确认过的信息</p>
          <div style={{ padding: '8px 0 6px' }}>
            <textarea className={s.textarea} value={supplement}
              placeholder="例如：简历里没写，我上学期自学过 Spark；想先在中小公司积累经验，不想去外包"
              onChange={e => { setSupplement(e.target.value); setParsedLines(null); dirty.current = true; }} />
            {parsedLines && (
              <div className={s.parsed}>
                已解析你补充的内容（只解析这里，不改动上面已确认的信息），请确认：<br />
                {parsedLines.length ? parsedLines.map(l => <div key={l}>· <b>{l}</b></div>) : <div>没有识别到需要新增的内容</div>}
                确认无误后再次点击"{edit ? '保存修改' : '确认并开始第 1 轮'}"。
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="e-foot"><div>
        <a className="btn lg" href={edit ? '/overview' : '/upload'}>返回</a>
        <span className={s.right}>
          <span className="muted" style={{ fontSize: 13 }}>{savedAt ? `草稿已自动保存 · ${savedAt}` : ''}</span>
          <button className="btn primary lg" disabled={busy || generating} onClick={onSave}>{busy ? '处理中…' : edit ? '保存修改' : '确认并开始第 1 轮 →'}</button>
        </span>
      </div></div>
      {ask && round && (
        <Modal title="保存修改？" okText={regenerates ? '保存并重新生成' : '保存'} onOk={() => void submit()} onCancel={() => setAsk(false)}>
          {regenerates
            ? <>第 {round.no} 轮还没有确认投递，保存后将用新的画像<b>重新生成第 {round.no} 轮推荐</b>。<br />你在推荐页已做的勾选和跳过会被清空。</>
            : <>第 {round.no} 轮已经投递，本轮推荐不变。<br /><b>此次修改将用于第 {round.no + 1} 轮推荐。</b></>}
        </Modal>
      )}
      {toastNode}
    </div>
  );
}
