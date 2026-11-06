'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, Camera, CameraOff, CheckCircle2, ScanLine, ShieldAlert, XCircle } from 'lucide-react';
import { Guard } from '@/components/AuthProvider';
import { Notice } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { fmtShort } from '@/lib/format';

type Outcome = 'VALID_ENTRY' | 'ALREADY_USED' | 'PAYMENT_UNVERIFIED' | 'TICKET_INVALID' | 'WRONG_EVENT';
interface ScanResponse {
  result: Outcome; message: string;
  ticket: { ticketNumber: number; of: number; attendee: string; bookingReference: string; eventTitle: string; checkedInAt: string | null } | null;
}
interface EventOption { id: string; title: string; status: string; startsAt: string }

const LOOK: Record<Outcome, { title: string; box: string; Icon: typeof CheckCircle2 }> = {
  VALID_ENTRY: { title: 'VALID ENTRY', box: 'bg-ok text-white', Icon: CheckCircle2 },
  ALREADY_USED: { title: 'ALREADY USED', box: 'bg-warn-soft text-warn ring-4 ring-warn', Icon: AlertTriangle },
  PAYMENT_UNVERIFIED: { title: 'PAYMENT UNVERIFIED', box: 'bg-warn-soft text-warn ring-4 ring-warn', Icon: ShieldAlert },
  TICKET_INVALID: { title: 'TICKET INVALID', box: 'bg-bad text-white', Icon: XCircle },
  WRONG_EVENT: { title: 'WRONG EVENT', box: 'bg-bad text-white', Icon: XCircle },
};

export default function CheckIn() {
  return <Guard roles={['organizer', 'admin']}><Scanner /></Guard>;
}

function Scanner() {
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventId, setEventId] = useState('');
  const [running, setRunning] = useState(false);
  const [camError, setCamError] = useState('');
  const [res, setRes] = useState<ScanResponse | null>(null);
  const [fail, setFail] = useState('');
  const [manual, setManual] = useState('');
  const scanner = useRef<import('html5-qrcode').Html5Qrcode | null>(null);
  const locked = useRef(false);       // true while a result is on screen or a scan is in flight
  const eventRef = useRef('');
  eventRef.current = eventId;

  useEffect(() => {
    api<{ events: EventOption[] }>('/organizer/events').then((d) => {
      const live = d.events.filter((e) => e.status === 'PUBLISHED' || e.status === 'SOLD_OUT').sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
      setEvents(live);
      if (live.length === 1) setEventId(live[0].id);
    }).catch(() => undefined);
  }, []);

  const verify = useCallback(async (text: string) => {
    setFail('');
    try {
      const r = await api<ScanResponse>('/tickets/verify-scan', { json: { code: text, eventId: eventRef.current || undefined } });
      setRes(r);
      if (typeof navigator.vibrate === 'function') navigator.vibrate(r.result === 'VALID_ENTRY' ? 80 : [120, 60, 120]);
    } catch (e) {
      setFail(errorMessage(e));
      locked.current = false;
    }
  }, []);

  const next = useCallback(() => { setRes(null); locked.current = false; }, []);

  // Valid entries clear themselves so the queue keeps moving; every warning needs a deliberate tap.
  useEffect(() => {
    if (res?.result !== 'VALID_ENTRY') return;
    const t = setTimeout(next, 2500);
    return () => clearTimeout(t);
  }, [res, next]);

  async function start() {
    setCamError('');
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const s = new Html5Qrcode('qr-reader', { verbose: false });
      scanner.current = s;
      await s.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: (w, h) => { const m = Math.floor(Math.min(w, h) * 0.75); return { width: m, height: m }; } },
        (text) => { if (locked.current) return; locked.current = true; void verify(text); },
        () => undefined,
      );
      setRunning(true);
    } catch {
      scanner.current = null;
      setCamError(window.isSecureContext ? 'Camera access was blocked or no camera was found. Allow camera permission in your browser, or enter the ticket code below.' : 'Browsers only allow camera access on HTTPS pages. Open QuickTix over https:// or enter the ticket code below.');
    }
  }

  async function stop() {
    const s = scanner.current;
    scanner.current = null;
    setRunning(false);
    if (s) { try { await s.stop(); s.clear(); } catch { /* already stopped */ } }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { void stop(); }, []);

  function submitManual(e: FormEvent) {
    e.preventDefault();
    if (!manual.trim() || locked.current) return;
    locked.current = true;
    void verify(manual).then(() => setManual(''));
  }

  const look = res ? LOOK[res.result] : null;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div><h1 className="text-3xl font-extrabold sm:text-4xl">Entry check-in</h1><p className="text-ink-soft">Point the camera at a ticket’s QR code. Each code works once.</p></div>

      <div>
        <label className="label" htmlFor="ev">Checking in for</label>
        <select id="ev" className="input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
          <option value="">Any of my events</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.title} ({fmtShort(e.startsAt)})</option>)}
        </select>
        <p className="hint">Choose the event at the door so tickets from other events are flagged.</p>
      </div>

      <div className="relative overflow-hidden rounded-2xl bg-ink">
        <div id="qr-reader" className="min-h-[300px] w-full [&_video]:w-full" />
        {!running && (
          <div className="absolute inset-0 grid place-items-center bg-ink p-6 text-center text-white">
            <div className="space-y-3"><ScanLine className="mx-auto h-10 w-10 text-lilac" aria-hidden /><button className="btn-primary" onClick={start}><Camera className="h-4 w-4" aria-hidden />Start camera</button></div>
          </div>
        )}
        {look && res && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-ink/80 p-4" role="alert" aria-live="assertive">
            <div className={`w-full space-y-3 rounded-2xl p-6 text-center ${look.box}`}>
              <look.Icon className="mx-auto h-14 w-14" aria-hidden />
              <p className="font-display text-3xl font-extrabold">{look.title}</p>
              {res.ticket ? (
                <div className="space-y-0.5 text-base font-semibold">
                  <p>{res.ticket.attendee}</p>
                  <p className="text-sm opacity-90">Ticket {res.ticket.ticketNumber} of {res.ticket.of}, {res.ticket.bookingReference}</p>
                  {res.result === 'ALREADY_USED' && res.ticket.checkedInAt && <p className="text-sm">First scanned {fmtShort(res.ticket.checkedInAt)}</p>}
                </div>
              ) : <p className="text-sm font-semibold">{res.message}</p>}
              {res.result === 'PAYMENT_UNVERIFIED' && <p className="text-sm font-semibold">Do not admit until the organizer approves the payment.</p>}
              <button className="btn mt-2 w-full bg-white text-ink hover:bg-paper" onClick={next}>Scan next ticket</button>
            </div>
          </div>
        )}
      </div>

      {running && <button className="btn-ghost" onClick={stop}><CameraOff className="h-4 w-4" aria-hidden />Stop camera</button>}
      {camError && <Notice>{camError}</Notice>}
      {fail && <Notice>{fail}</Notice>}

      <form onSubmit={submitManual} className="panel space-y-2">
        <label className="label" htmlFor="manual">Or enter a ticket code</label>
        <div className="flex gap-2"><input id="manual" className="input font-mono" autoCapitalize="none" autoComplete="off" placeholder="Ticket code printed under the QR" value={manual} onChange={(e) => setManual(e.target.value)} /><button className="btn-primary">Check</button></div>
      </form>
    </div>
  );
}
