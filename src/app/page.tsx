'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EntryHeader, useToast } from '@/components/common/ui';
import s from './page.module.css';

const PERSONAS = [
  { key: 'xiaozhou', av: '周', name: '小周 · 技术实习', desc: '计算机 · 大三 · 2027 届\n后端 / 数据开发日常实习 · 北京、上海' },
  { key: 'xiaochen', av: '陈', name: '小陈 · 跨专业转产品', desc: '信息管理 · 大四 · 2026 届\n产品经理 / AI 产品校招 · 杭州、上海' },
  { key: 'xiaoxu', av: '许', name: '小许 · 运营校招', desc: '汉语言文学 · 大四 · 2026 届\n新媒体 / 内容运营校招 + 暑期实习 · 广州、深圳' },
];

export default function HomePage() {
  const router = useRouter();
  const { toast, toastNode } = useToast();
  const [hasProfile, setHasProfile] = useState(false);

  useEffect(() => {
    fetch('/api/session').then(r => r.json()).then(d => setHasProfile(!!d.hasProfile)).catch(() => {});
  }, []);

  return (
    <>
      <EntryHeader onLogin={() => toast('第二版开放：使用 ResumeIQ 账号登录，保存进度')} />
      <section className={s.hero}>
        <span className={s.eyebrow}><i />AI Agent · 实习 / 校招</span>
        <h1>少一点海投，<br />多一点有把握的投递</h1>
        <p>上传简历，AI Agent 求职管家帮你筛岗位、管进度，<br />并在每一轮之后告诉你哪里出了问题、下一轮怎么调。</p>
        <button className={s.cta} onClick={() => router.push('/upload')}>上传简历，开始求职 <span>→</span></button>
        {hasProfile && <a className={s.continue} href="/overview">继续上次的求职 ›</a>}
        <div className={s.hint}>支持 PDF、DOCX · 无需注册</div>
      </section>

      <div className={s.values}>
        <div className={`card ${s.value}`}><b>推荐有依据</b><p>每个岗位分为"推荐 / 可以考虑 / 不推荐"，逐条说明满足了哪些要求、缺了什么，不打分。</p></div>
        <div className={`card ${s.value}`}><b>进度不再乱</b><p>投递、笔试、面试集中在一张看板上，临近截止的岗位优先提醒。</p></div>
        <div className={`card ${s.value}`}><b>越投越准</b><p>每轮结束后 Agent 分析结果、找出原因，提出策略调整，你确认后生效。</p></div>
      </div>

      <div className={s.demo}>
        <h2>没有简历？先看看示例</h2>
        <p className={s.sub}>以下人物均为虚构，第 1 轮已完成，进入即可看到推荐、投递记录和复盘。</p>
        <div className={s.personas}>
          {PERSONAS.map(p => (
            <div key={p.key} className={`card ${s.pcard}`}>
              <div className={s.av}>{p.av}</div>
              <b>{p.name}</b>
              <p style={{ whiteSpace: 'pre-line' }}>{p.desc}</p>
              <button className="btn primary sm" onClick={() => toast('演示人物将在开发后期开放，现在可以先上传自己的简历体验')}>
                以{p.name.split(' ')[0]}身份体验
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className={s.privacy}>你上传的简历只与当前浏览器关联，7 天后自动删除；更换设备或清除浏览器数据后进度不保留。</div>
      {toastNode}
    </>
  );
}
