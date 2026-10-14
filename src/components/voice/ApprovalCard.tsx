/**
 * One live approval, decided while the caller is on hold (S11 §6.5). The S11
 * default gives it 25 seconds, hence the ring rather than a number.
 *
 * The countdown comes from the server's `expires_at` on every tick, never from
 * a timer started at mount: a card that appears 4s late shows 21s, not 25.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Phone, PhoneOff, ShieldQuestion, TimerOff, X } from 'lucide-react';
import type { ApprovalState, VoiceApproval } from '@/lib/api/voice';
import { cn } from '@/lib/utils';

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;

/** Time left in ms, from the server's absolute expiry. */
export function msRemaining(expiresAt: string, now = Date.now()): number {
  const t = new Date(expiresAt).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, t - now);
}

const TERMINAL_META: Record<
  Exclude<ApprovalState, 'pending'>,
  { icon: typeof Check; label: string; tone: string }
> = {
  approved: { icon: Check, label: 'Approved — the agent is doing it now', tone: 'text-green-700' },
  denied: { icon: X, label: 'Denied — the agent will say no', tone: 'text-red-700' },
  expired: { icon: TimerOff, label: 'Expired — the agent moved on', tone: 'text-amber-700' },
  call_ended: { icon: PhoneOff, label: 'Call ended before a decision', tone: 'text-[var(--text-4)]' },
};

function ArgRow({ name, value }: { name: string; value: string | number | boolean | null }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="shrink-0 font-mono text-[10.5px] text-[var(--text-5)]">{name}</span>
      <span className="min-w-0 flex-1 break-words text-[var(--text-2)]">
        {value === null || value === '' ? '—' : String(value)}
      </span>
    </div>
  );
}

export function ApprovalCard({
  approval,
  state,
  deciding,
  error,
  onDecide,
  muted,
  onToggleMute,
  threadSubject,
}: {
  approval: VoiceApproval;
  state: ApprovalState;
  /** Which button was pressed — both disable on the first click. */
  deciding: 'approve' | 'deny' | null;
  error: string | null;
  onDecide: (decision: 'approve' | 'deny') => void;
  muted: boolean;
  onToggleMute: () => void;
  /**
   * S14 §4.4: the matter the requesting call belongs to. Passed in rather
   * than looked up — the card is presentational and renders outside any
   * query provider in tests and in the popped-out window.
   */
  threadSubject?: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  // What the ring is drawn against: the time left when the card first appeared.
  // The remaining time is always server-derived; only this reference is local.
  const windowMs = useRef(Math.max(msRemaining(approval.expires_at), 1_000));

  useEffect(() => {
    if (state !== 'pending') return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [state]);

  const remaining = msRemaining(approval.expires_at, now);
  const fraction = Math.max(0, Math.min(1, remaining / windowMs.current));
  const seconds = Math.ceil(remaining / 1000);

  const ringTone = fraction > 0.4 ? 'var(--brand)' : fraction > 0.2 ? '#b45309' : 'var(--bad-fg)';
  const args = useMemo(() => Object.entries(approval.args_preview ?? {}), [approval.args_preview]);

  if (state !== 'pending') {
    const meta = TERMINAL_META[state];
    const Icon = meta.icon;
    return (
      <div
        data-testid="voice-approval-card"
        data-approval-state={state}
        className="w-[360px] rounded-[14px] border border-[var(--line)] bg-white p-4 shadow-[0_18px_40px_-18px_rgba(20,22,26,0.34)]"
      >
        <div className="flex items-center gap-2.5">
          <Icon className={cn('h-4 w-4', meta.tone)} />
          <p className={cn('text-sm font-semibold', meta.tone)}>{meta.label}</p>
        </div>
        <p className="mt-1.5 truncate text-xs text-[var(--text-4)]">{approval.summary}</p>
      </div>
    );
  }

  return (
    <div
      data-testid="voice-approval-card"
      data-approval-state="pending"
      role="alertdialog"
      aria-label={`Approval required: ${approval.summary}`}
      className="w-[360px] rounded-[14px] border border-[var(--line)] bg-white p-4 shadow-[0_18px_40px_-18px_rgba(20,22,26,0.34)]"
    >
      <div className="flex items-start gap-3">
        {/* Countdown ring */}
        <div className="relative h-9 w-9 shrink-0">
          <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90">
            <circle cx="18" cy="18" r={RING_R} fill="none" stroke="var(--sand-deep)" strokeWidth="3" />
            <circle
              cx="18"
              cy="18"
              r={RING_R}
              fill="none"
              stroke={ringTone}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - fraction)}
            />
          </svg>
          <span
            className="absolute inset-0 flex items-center justify-center font-mono text-[10px] tabular-nums"
            style={{ color: ringTone }}
            data-testid="voice-approval-countdown"
          >
            {seconds}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-5)]">
            <ShieldQuestion className="h-3 w-3" />
            Approval required
          </p>
          <p className="mt-1 text-sm font-semibold leading-snug text-[var(--ink)]">{approval.summary}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-700">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-600" />
            </span>
            <Phone className="h-3 w-3" />
            Caller on hold
            <span className="font-mono text-[10px] text-[var(--text-5)]">{approval.call_sid.slice(-8)}</span>
          </p>
          {/* Deciding mid-call is easier when you know which matter it is. */}
          {threadSubject && (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--text-4)]">
              <span aria-hidden="true">🧵</span>
              <span className="min-w-0 truncate" title={threadSubject}>
                {threadSubject}
              </span>
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleMute}
          className="shrink-0 rounded-md px-1.5 py-1 text-[10px] font-medium text-[var(--text-5)] hover:text-[var(--ink)]"
          title={muted ? 'Approval sound is off' : 'Approval sound is on'}
        >
          {muted ? '🔇' : '🔔'}
        </button>
      </div>

      {!!args.length && (
        <div className="mt-3 space-y-1 rounded-[10px] bg-[var(--sand)] px-3 py-2">
          <p className="font-mono text-[10px] text-[var(--text-5)]">{approval.tool_name}</p>
          {args.map(([k, v]) => (
            <ArgRow key={k} name={k} value={v} />
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-[11px] text-[var(--bad-fg)]">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          data-testid="voice-approval-approve"
          disabled={!!deciding}
          onClick={() => onDecide('approve')}
          className="flex-1 rounded-full bg-[var(--ink)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          {deciding === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          data-testid="voice-approval-deny"
          disabled={!!deciding}
          onClick={() => onDecide('deny')}
          className="flex-1 rounded-full border border-[var(--line)] px-3 py-2 text-xs font-semibold text-[var(--text-2)] hover:border-[var(--ink)] hover:text-[var(--ink)] disabled:opacity-40"
        >
          {deciding === 'deny' ? 'Denying…' : 'Deny'}
        </button>
      </div>
    </div>
  );
}
