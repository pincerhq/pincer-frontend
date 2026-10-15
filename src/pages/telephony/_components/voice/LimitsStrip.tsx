/**
 * Outbound guardrails, in the page header (Sprint 8 T8.3).
 *
 * Three facts the operator needs before pressing "New call": how much of
 * today's allowance is gone, whether quiet hours are currently suppressing
 * outbound, and how many numbers are on the do-not-call list. Each renders
 * only if the backend actually reports it — a header that invents "0/0 calls"
 * is worse than a header that stays quiet.
 */
import { useState } from 'react';
import { Ban, Moon } from 'lucide-react';
import { useContacts, useVoiceStatus } from '@/lib/api/voice';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/** Read-only: the opt-out list is managed on the backend, not from here. */
function OptOutListModal({ count, onClose }: { count: number; onClose: () => void }) {
  const { data: contacts } = useContacts();
  const optedOut = (contacts ?? []).filter((c) => c.opted_out);
  const unknown = Math.max(0, count - optedOut.length);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md gap-0 p-0">
        <div className="border-b border-[var(--line-soft)] px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
            <Ban className="h-4 w-4 text-red-500" />
            Do-not-call list
          </DialogTitle>
          <p className="mt-1 text-[11px] text-[var(--text-5)]">
            {count} number{count === 1 ? '' : 's'} the agent will not dial. Read-only — entries are
            added by the backend when someone opts out on a call.
          </p>
        </div>
        <div className="max-h-80 overflow-y-auto px-5 py-3">
          {optedOut.length === 0 && unknown === 0 ? (
            <p className="py-6 text-center text-xs text-[var(--text-5)]">Nobody has opted out.</p>
          ) : (
            <ul className="space-y-1.5">
              {optedOut.map((c) => (
                <li key={c.phone_number} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate text-[var(--ink)]">{c.name}</span>
                  <span className="shrink-0 font-mono text-xs text-[var(--text-5)]">
                    {c.phone_number}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {unknown > 0 && (
            <p className="mt-3 border-t border-[var(--line-soft)] pt-2.5 text-[11px] leading-relaxed text-[var(--text-5)]">
              {unknown} further opted-out number{unknown === 1 ? ' is' : 's are'} not in the contact
              list, and the backend has no endpoint that lists them yet — the count above is the
              authority.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function LimitsStrip() {
  const { data: st } = useVoiceStatus();
  const [showOptOut, setShowOptOut] = useState(false);

  if (!st) return null;

  const used = st.daily_calls_used;
  const limit = st.daily_calls_limit;
  const hasQuota = used != null;
  const pct = hasQuota && limit ? Math.min(100, (used / limit) * 100) : 0;
  const nearLimit = hasQuota && limit != null && used >= limit * 0.8;
  const atLimit = hasQuota && limit != null && used >= limit;

  const dnc = st.do_not_call_count;

  if (!hasQuota && !st.quiet_hours_active && dnc == null) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {hasQuota && (
          <div
            className="flex items-center gap-2 rounded-full border border-[var(--line)] py-1 pl-2.5 pr-3"
            title={
              limit == null
                ? 'No daily outbound limit configured'
                : `Daily outbound limit: ${used} of ${limit} used`
            }
          >
            <span
              className={cn(
                'text-[10px] font-semibold tabular-nums',
                atLimit ? 'text-red-600' : nearLimit ? 'text-amber-700' : 'text-[var(--text-3)]',
              )}
            >
              {used}
              {limit != null ? `/${limit}` : ''}
            </span>
            <span className="text-[10px] text-[var(--text-5)]">calls today</span>
            {limit != null && (
              <span className="h-1 w-12 overflow-hidden rounded-full bg-[var(--sand-deep)]">
                <span
                  className={cn(
                    'block h-full rounded-full',
                    atLimit ? 'bg-red-500' : nearLimit ? 'bg-amber-500' : 'bg-[var(--ink)]',
                  )}
                  style={{ width: `${pct}%` }}
                />
              </span>
            )}
          </div>
        )}

        {st.quiet_hours_active && (
          <span className="flex items-center gap-1 rounded-full bg-[var(--brand-100)] px-2 py-1 text-[10px] font-medium text-[var(--brand)]">
            <Moon className="h-3 w-3" />
            {st.quiet_hours_until
              ? `outbound paused until ${st.quiet_hours_until}`
              : 'outbound paused (quiet hours)'}
          </span>
        )}

        {dnc != null && dnc > 0 && (
          <button
            type="button"
            onClick={() => setShowOptOut(true)}
            className="flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-1 text-[10px] font-medium text-[var(--text-3)] transition-colors hover:bg-[var(--sand)] hover:text-[var(--ink)]"
            title="Numbers the agent will not dial"
          >
            <Ban className="h-3 w-3 text-red-500" />
            {dnc} opted out
          </button>
        )}
      </div>

      {showOptOut && dnc != null && (
        <OptOutListModal count={dnc} onClose={() => setShowOptOut(false)} />
      )}
    </>
  );
}
