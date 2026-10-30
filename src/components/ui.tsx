import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Freshness, Quote, SignalLevel } from '../lib/types';
import { LEVEL_LABEL } from '../lib/analysis';
import { FRESHNESS_LABEL, quoteFreshness } from '../lib/integrity';
import { usd } from '../lib/format';
import { useNow } from '../state/data';

export function SignalBadge({ level, size = 'md' }: { level: SignalLevel; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`sig sig-${level.toLowerCase()} sig-${size}`}>{LEVEL_LABEL[level]}</span>;
}

/** 0-100 スコアのリングゲージ */
export function ScoreRing({ value, size = 56, label }: { value: number | null; size?: number; label?: string }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  const color = value === null ? 'var(--muted)' : v >= 58 ? 'var(--up)' : v <= 42 ? 'var(--down)' : 'var(--warn)';
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth="4" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="4" fill="none" strokeLinecap="round"
          strokeDasharray={`${(c * v) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ filter: `drop-shadow(0 0 4px ${color})`, transition: 'stroke-dasharray .6s ease' }} />
      </svg>
      <div className="ring-val">
        <b style={{ fontSize: size * 0.3 }}>{value ?? '--'}</b>
        {label && <small>{label}</small>}
      </div>
    </div>
  );
}

/** 価格変化時にフラッシュする数値 */
export function LivePrice({ value, className = '' }: { value: number | null | undefined; className?: string }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState('');
  useEffect(() => {
    if (value != null && prev.current != null && value !== prev.current) {
      setFlash(value > prev.current ? 'flash-up' : 'flash-down');
      const t = setTimeout(() => setFlash(''), 700);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  return <span className={`mono ${className} ${flash}`}>{usd(value)}</span>;
}

export function FreshTag({ quote }: { quote: Quote | null }) {
  const now = useNow(5000);
  const f: Freshness = quoteFreshness(quote, now);
  if (quote?.source === 'demo') return <span className="fresh fresh-demo">DEMO</span>;
  return <span className={`fresh fresh-${f}`}><i />{FRESHNESS_LABEL[f]}</span>;
}

export function Card({ children, className = '', title, right }: { children: ReactNode; className?: string; title?: ReactNode; right?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <header className="card-h">
          <h3>{title}</h3>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet-grip" />
        <header className="sheet-h">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Skeleton({ h = 64 }: { h?: number }) {
  return <div className="skel" style={{ height: h }} />;
}
