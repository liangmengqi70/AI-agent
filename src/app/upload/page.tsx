'use client';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import { EntryHeader, Steps, useToast } from '@/components/common/ui';
import s from './upload.module.css';

type StepState = 'wait' | 'run' | 'ok' | 'fail';
type Result = { fileName: string; chars: number; manual: boolean; filled: number; toConfirm: number; missing: number };

const MAX_BYTES = 10 * 1024 * 1024;

/** 前端先做一遍格式和大小检查，减少无效上传（后端还会再检查一次） */
function checkFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'doc') return '暂不支持旧版 DOC 文件，请在 Word 中另存为 DOCX 或 PDF 后重新上传。';
  if (ext !== 'pdf' && ext !== 'docx') return '只支持 PDF、DOCX 格式的简历。';
  if (file.size > MAX_BYTES) return '简历文件不能超过 10MB。';
  if (!file.size) return '简历文件为空，请重新选择。';
  return null;
}

export default function UploadPage() {
  const router = useRouter();
  const { toast, toastNode } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [steps, setSteps] = useState<StepState[]>(['wait', 'wait', 'wait']);
  const [result, setResult] = useState<Result | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  async function upload(file: File) {
    const problem = checkFile(file);
    if (problem) { setError(problem); return; }
    setError(''); setResult(null); setFileName(file.name);
    // 进度：提取文本 → 理解简历（等待接口）→ 检查完整性
    setSteps(['run', 'wait', 'wait']);
    timers.current.push(setTimeout(() => setSteps(['ok', 'run', 'wait']), 1500));
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/resume', { method: 'POST', body: form });
      const body = await res.json();
      timers.current.forEach(clearTimeout);
      if (!res.ok) {
        setSteps(st => st.map(x => (x === 'run' ? 'fail' : x)) as StepState[]);
        setError(body.error || '解析失败，请重试');
        return;
      }
      setSteps(['ok', 'ok', 'ok']);
      setResult(body);
    } catch {
      timers.current.forEach(clearTimeout);
      setSteps(st => st.map(x => (x === 'run' ? 'fail' : x)) as StepState[]);
      setError('网络或服务异常，请稍后重试');
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0]; if (f) upload(f);
  }

  const started = steps[0] !== 'wait';
  const labels = ['提取文本', '理解简历，整理画像并推测意向', '检查信息是否完整'];
  const actors = ['程序', '大模型', '程序'];
  const outcome = result && [
    `约 ${result.chars.toLocaleString()} 字`,
    result.manual ? '内容较少，请手动填写' : `整理出 ${result.filled} 项信息`,
    `${result.toConfirm} 项需确认，${result.missing} 项待补充`,
  ];

  return (
    <div className={s.page}>
      <EntryHeader onLogin={() => toast('第二版开放：使用 ResumeIQ 账号登录，保存进度')} />
      <Steps current={1} />
      <div className={s.main}>
        <h1>上传你的简历</h1>
        <p className={s.lead}>AI Agent 求职管家会读取你的简历，整理出你的画像，并推测你可能的求职意向。<br />推测的内容都需要你确认后才会生效。</p>

        <input ref={input} type="file" accept=".pdf,.docx,.doc" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
        {!started && (
          <button type="button" className={`${s.drop} ${dragging ? s.dragging : ''}`} onClick={() => input.current?.click()}
            onDragEnter={e => { e.preventDefault(); setDragging(true); }} onDragOver={e => e.preventDefault()}
            onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            <div className={s.upi}>↑</div>
            <strong>拖拽文件到这里，或<u>点击选择文件</u></strong>
            <span>支持 PDF、DOCX，10MB 以内 · 扫描版 PDF 会自动识别文字，耗时稍长</span>
          </button>
        )}

        {started && (
          <div className={`card ${s.parse}`}>
            <h3>{result ? '已读取' : '正在读取'}：{fileName}</h3>
            {labels.map((label, i) => (
              <div key={label} className={`${s.pstep} ${s[steps[i]] ?? ''}`}>
                <span className={s.s}>{steps[i] === 'ok' ? '✓' : steps[i] === 'fail' ? '!' : ''}</span>
                {label}<em>{outcome ? outcome[i] : actors[i]}</em>
              </div>
            ))}
          </div>
        )}
        <p className={s.err}>{error}</p>
        {started && (
          <button className={`link-btn ${s.reupload}`} onClick={() => input.current?.click()}>重新上传</button>
        )}
      </div>
      <div className="e-foot"><div>
        <a className="btn lg" href="/">返回</a>
        <button className="btn primary lg" disabled={!result} onClick={() => router.push('/confirm')}>下一步</button>
      </div></div>
      {toastNode}
    </div>
  );
}
