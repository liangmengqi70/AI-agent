'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/* ---------- 提示条 ---------- */
export function useToast() {
  const [msg, setMsg] = useState('');
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((m: string) => {
    setMsg(m); setShow(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 3000);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const node = <div className={`toast ${show ? 'show' : ''}`} role="status">{msg}</div>;
  return { toast, toastNode: node };
}

/* ---------- 确认框 ---------- */
export function Modal({ title, children, okText, onOk, onCancel }: {
  title: string; children: ReactNode; okText: string; onOk: () => void; onCancel: () => void;
}) {
  return (
    <div className="modal-wrap" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{children}</p>
        <div className="modal-a">
          <button className="btn" onClick={onCancel}>再看看</button>
          <button className="btn primary" onClick={onOk}>{okText}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 入口页头部 ---------- */
export function EntryHeader({ onLogin }: { onLogin: () => void }) {
  return (
    <header className="e-header">
      <a className="e-brand" href="/">AI Agent 求职管家</a>
      <button className="btn primary" onClick={onLogin}>登录保存进度</button>
    </header>
  );
}

/* ---------- 步骤条 ---------- */
export function Steps({ current }: { current: 1 | 2 | 3 }) {
  const items = ['上传简历', '确认画像与偏好', '开始第 1 轮'];
  return (
    <div className="steps">
      <ol>
        {items.map((label, i) => {
          const n = i + 1;
          const cls = n < current ? 'fin' : n === current ? 'cur' : '';
          return (
            <li key={label} className={cls} style={{ display: 'contents' }}>
              {i > 0 && <span className="ln" />}
              <span className={cls} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="sn">{n < current ? '✓' : n}</span>{label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
