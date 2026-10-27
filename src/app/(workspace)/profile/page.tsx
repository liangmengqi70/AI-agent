'use client';
import { useEffect, useState } from 'react';
import type { ProfileData } from '@/domain/profile';
import s from '../workspace.module.css';

// 画像页：查看当前确认的画像与求职偏好；修改进入确认页的修改模式
type Data = { version: number; roundVersion: number | null; data: ProfileData; extendedReason: string | null; round: { no: number; status: string } | null } | null;

const JOB_TYPE = { intern: '实习', campus: '校招', both: '实习和校招都看' } as const;
const range = (x: { usual: number | null; max: number | null }, unit: string, verb: string) =>
  x.usual ? `通常 ${x.usual} ${unit}，最多${verb} ${x.max ?? x.usual} ${unit}` : '未填写';
const list = (xs: string[]) => xs.length ? xs.join('、') : '—';

export default function ProfilePage() {
  const [d, setD] = useState<Data | undefined>(undefined);
  useEffect(() => { fetch('/api/profile/current').then(r => r.json()).then(setD).catch(() => setD(null)); }, []);

  if (d === undefined) return <div className={s.page}><div className={`card ${s.state}`}>正在读取…</div></div>;
  if (!d) return <div className={s.page}><div className={`card ${s.state}`}><b>还没有画像</b><a className="btn primary" href="/upload" style={{ marginTop: 14 }}>上传简历</a></div></div>;

  const { basics, skills, courses, experiences, awards, prefs } = d.data;
  const dir = prefs.directions;
  const intern = prefs.jobType !== 'campus';
  const pending = d.round && d.roundVersion !== null && d.version !== d.roundVersion; // 新版本还没用上（本轮已投递）
  const line = (k: string, v: React.ReactNode) => <div className={s.line}><span className={s.k}>{k}</span><span>{v}</span></div>;

  return (
    <div className={s.page}>
      <div className={s.boardTools}>
        <span className="muted" style={{ fontSize: 13 }}>
          当前画像 v{d.version}
          {d.round && (pending ? `，将用于第 ${d.round.no + 1} 轮推荐（第 ${d.round.no} 轮使用 v${d.roundVersion}）` : `，第 ${d.round.no} 轮正在使用`)}
        </span>
        <a className="btn primary" href="/confirm?mode=edit" style={{ marginLeft: 'auto' }}>修改画像与偏好</a>
      </div>
      <div className={s.grid2}>
        <div className="card">
          <div className={s.cardH}><h3>画像</h3><span className={s.sub}>来自简历，经你确认</span></div>
          <div className={s.cardB}>
            {line('学校 / 学历', `${basics.school ?? '—'} · ${basics.degree ?? '—'}`)}
            {line('专业', basics.major ?? '—')}
            {line('毕业届别', basics.gradYear ? `${basics.gradYear} 届` : '—')}
            {line('技能', list(skills))}
            {line('主修课程', list(courses))}
            {line('项目 / 实习', experiences.length ? <span>{experiences.map((e, i) => <span key={i} style={{ display: 'block' }}>{e.kind === 'internship' ? '实习' : '项目'}：{e.title}{e.role ? ` · ${e.role}` : ''}</span>)}</span> : '—')}
            {line('竞赛 / 证书', list(awards))}
          </div>
        </div>
        <div className="card">
          <div className={s.cardH}><h3>求职偏好</h3></div>
          <div className={s.cardB}>
            {line('求职类型', `${JOB_TYPE[prefs.jobType ?? 'intern']}${intern && prefs.internKinds.length ? `（${prefs.internKinds.map(k => k === 'daily' ? '日常实习' : '暑期实习').join('、')}）` : ''}`)}
            {line('方向', <span>首选 {list(dir.preferred)}；可接受 {list(dir.acceptable)}
              {dir.extended.length > 0 && <span style={{ display: 'block' }} className="muted" title={d.extendedReason ?? ''}>延伸（AI 推测）：{dir.extended.join('、')}</span>}
              {dir.excluded.length > 0 && <span style={{ display: 'block' }} className="muted">不考虑：{dir.excluded.join('、')}</span>}</span>)}
            {line('城市', prefs.cities.anyCity ? '不限城市' : `首选 ${list(prefs.cities.preferred)}；可接受 ${list(prefs.cities.acceptable)}${prefs.cities.remoteOk ? '；接受远程' : ''}`)}
            {intern && line('实习薪资', prefs.internPayMin ? `不低于 ${prefs.internPayMin} 元/天` : '不限')}
            {prefs.jobType !== 'intern' && line('校招薪资', prefs.campusPayMin ? `不低于 ${prefs.campusPayMin}K/月` : '不限')}
            {intern && line('每周到岗', range(prefs.daysPerWeek, '天', '可调整到'))}
            {intern && line('实习时长', range(prefs.months, '个月', '可延长到'))}
            {line('看重转正', prefs.valueConversion ? '是' : '否')}
            {prefs.avoid.length > 0 && line('不想去', list(prefs.avoid))}
          </div>
        </div>
      </div>
    </div>
  );
}
