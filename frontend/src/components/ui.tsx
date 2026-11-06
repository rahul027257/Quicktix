'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, QrCode as QrIcon } from 'lucide-react';
import QRCode from 'qrcode';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/format';

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_TONE[status] ?? 'bg-lilac/60 text-ink-soft'}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-ink-soft" role="status">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function Notice({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info'; children: ReactNode }) {
  const cls = tone === 'error' ? 'bg-bad-soft text-bad' : tone === 'success' ? 'bg-ok-soft text-ok' : 'bg-brand-soft text-brand-dark';
  const Icon = tone === 'success' ? CheckCircle2 : AlertTriangle;
  return (
    <div className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm font-medium ${cls}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-lilac px-6 py-14 text-center">
      <h3 className="text-lg font-bold">{title}</h3>
      {children && <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-soft">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Renders a QR code for `value` entirely in the browser. */
export function QrImage({ value, size = 176, label }: { value: string; size?: number; label?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: 'M' }).then((u) => alive && setSrc(u));
    return () => { alive = false; };
  }, [value, size]);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} width={size} height={size} alt={label ?? 'QR code'} className="rounded-lg" />
  ) : (
    <div style={{ width: size, height: size }} className="grid place-items-center rounded-lg bg-brand-soft text-brand">
      <QrIcon className="h-8 w-8" aria-hidden />
    </div>
  );
}

/** mm:ss countdown against the SERVER clock, so a wrong device clock cannot fake extra time. */
export function Countdown({ expiresAt, serverNow, onExpire }: { expiresAt: string; serverNow: string; onExpire: () => void }) {
  const [offset] = useState(() => new Date(serverNow).getTime() - Date.now());
  const left = () => Math.max(0, new Date(expiresAt).getTime() - (Date.now() + offset));
  const [ms, setMs] = useState(left);

  useEffect(() => {
    const t = setInterval(() => {
      const v = left();
      setMs(v);
      if (v <= 0) { clearInterval(t); onExpire(); }
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);

  const s = Math.ceil(ms / 1000);
  const text = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return (
    <span role="timer" aria-live="off" className={`font-display text-3xl font-extrabold tabular-nums ${s <= 120 ? 'text-bad' : 'text-ink'}`}>
      {text}
    </span>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="rounded-lg bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand hover:bg-lilac"
      onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => undefined);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}
