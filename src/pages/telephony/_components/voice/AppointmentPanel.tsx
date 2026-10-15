/**
 * What the appointment call actually achieved (Sprint 6 T6.3/T6.4).
 *
 * The panel is deliberately unflattering when things go wrong: Sprint 6's
 * honesty rule says a calendar write that failed is NOT a booked appointment,
 * so the timeline stops at the step that failed, shows the backend's reason
 * verbatim, and names the follow-up state instead of quietly showing a green
 * "invitations sent".
 */
import { AlertTriangle, CalendarClock, Check, ExternalLink, RefreshCw, X } from 'lucide-react';
import {
  APPOINTMENT_STEPS,
  APPOINTMENT_TERMINAL,
  type AppointmentDetail,
} from '@/lib/api/voice';
import { humanizeCode } from '@/pages/telephony/_lib/voiceMeta';
import { cn } from '@/lib/utils';

const STEP_LABEL: Record<string, string> = {
  proposed: 'Slots proposed on the call',
  verified: 'Slot verified as free',
  calendar_created: 'Calendar event created',
  invitations_sent: 'Invitations sent',
};

function fmtSlot(iso: string, minutes?: number | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return minutes ? `${date} · ${time} (${minutes} min)` : `${date} · ${time}`;
}

function Step({
  label,
  state,
  detail,
}: {
  label: string;
  state: 'done' | 'failed' | 'pending';
  detail?: string | null;
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
          state === 'done' && 'border-[var(--ok-fill)] bg-[var(--ok-fill)] text-[var(--on-ok-fill)]',
          state === 'failed' && 'border-[var(--bad-fill)] bg-[var(--bad-fill)] text-[var(--on-bad-fill)]',
          state === 'pending' && 'border-[var(--line)] bg-[var(--paper)]',
        )}
      >
        {state === 'done' && <Check className="h-2.5 w-2.5" />}
        {state === 'failed' && <X className="h-2.5 w-2.5" />}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            'text-xs',
            state === 'pending' ? 'text-[var(--text-5)]' : 'text-[var(--text-2)]',
            state === 'failed' && 'font-medium text-red-700',
          )}
        >
          {label}
        </span>
        {detail && <span className="block text-[11px] leading-relaxed text-[var(--text-4)]">{detail}</span>}
      </span>
    </li>
  );
}

export default function AppointmentPanel({ appointment }: { appointment: AppointmentDetail }) {
  const terminal = (APPOINTMENT_TERMINAL as readonly string[]).includes(appointment.status);
  const reachedIndex = (APPOINTMENT_STEPS as readonly string[]).indexOf(appointment.status);
  // A terminal status says where it stopped, not how far it got: the calendar
  // link and the agreed slot are the evidence of the steps that did complete.
  const impliedProgress = appointment.calendar_event_link
    ? 2
    : appointment.agreed_datetime
      ? 1
      : appointment.candidates?.length
        ? 0
        : -1;
  const progress = Math.max(reachedIndex, impliedProgress);
  // The failure lands on the step *after* the last one that completed.
  const failedIndex = terminal || appointment.calendar_error ? progress + 1 : -1;

  const candidates = appointment.candidates ?? [];
  const attempts = appointment.attempts ?? [];

  return (
    <section className="rounded-[10px] border border-[var(--line)] bg-[var(--paper)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="plat-eyebrow flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5 text-[var(--text-5)]" />
          Appointment
        </p>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-medium',
            terminal || appointment.calendar_error
              ? 'border-red-200 bg-red-50 text-red-700'
              : appointment.status === 'invitations_sent'
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-[var(--line)] text-[var(--text-3)]',
          )}
        >
          {humanizeCode(appointment.status)}
        </span>
      </div>

      {appointment.topic && (
        <p className="mb-2 text-xs leading-relaxed text-[var(--text-3)]">{appointment.topic}</p>
      )}

      {/* Agreed slot — the headline answer */}
      <div className="mb-3 rounded-[8px] bg-[var(--sand)] px-2.5 py-2">
        <p className="text-[10px] uppercase tracking-wide text-[var(--text-5)]">Agreed slot</p>
        <p
          className={cn(
            'mt-0.5 text-sm font-semibold',
            appointment.agreed_datetime ? 'text-[var(--ink)]' : 'text-[var(--text-5)]',
          )}
        >
          {appointment.agreed_datetime
            ? fmtSlot(appointment.agreed_datetime, appointment.duration_minutes)
            : 'None agreed'}
        </p>
      </div>

      {/* Candidates offered vs. the one taken */}
      {candidates.length > 0 && (
        <div className="mb-3">
          <p className="plat-eyebrow mb-1">Slots offered ({candidates.length})</p>
          <ul className="space-y-1">
            {candidates.map((c, i) => {
              const taken =
                c.accepted ??
                (appointment.agreed_datetime != null &&
                  new Date(c.start).getTime() === new Date(appointment.agreed_datetime).getTime());
              return (
                <li
                  key={`${c.start}-${i}`}
                  className={cn(
                    'flex items-center gap-1.5 text-xs',
                    taken ? 'font-medium text-[var(--ink)]' : 'text-[var(--text-4)]',
                  )}
                >
                  {taken ? (
                    <Check className="h-3 w-3 shrink-0 text-green-600" />
                  ) : (
                    <span className="ml-1 h-1 w-1 shrink-0 rounded-full bg-[var(--text-5)]" />
                  )}
                  <span className={cn(!taken && 'line-through decoration-[var(--line)]')}>
                    {fmtSlot(c.start)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Status timeline */}
      <div className="mb-3">
        <p className="plat-eyebrow mb-1.5">Status</p>
        <ol className="space-y-1.5">
          {APPOINTMENT_STEPS.map((step, i) => (
            <Step
              key={step}
              label={STEP_LABEL[step] ?? humanizeCode(step)}
              state={i <= progress ? 'done' : i === failedIndex ? 'failed' : 'pending'}
              detail={i === failedIndex ? appointment.calendar_error : null}
            />
          ))}
        </ol>
      </div>

      {/* Honest failure surface */}
      {(appointment.calendar_error || appointment.follow_up) && (
        <div className="mb-3 rounded-[8px] border border-amber-200 bg-amber-50 px-2.5 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" />
            {appointment.calendar_error ? 'Calendar write failed' : 'Follow-up pending'}
          </p>
          {appointment.calendar_error && (
            <p className="mt-1 text-[11px] leading-relaxed text-amber-800/90">
              {appointment.calendar_error}
            </p>
          )}
          {appointment.follow_up && (
            <p className="mt-1 text-[11px] leading-relaxed text-amber-800/90">
              Follow-up: {appointment.follow_up}
            </p>
          )}
          <p className="mt-1 text-[10px] leading-relaxed text-amber-800/70">
            The slot is not booked — nobody has an invitation for it yet.
          </p>
        </div>
      )}

      {appointment.calendar_event_link && (
        <a
          href={appointment.calendar_event_link}
          target="_blank"
          rel="noreferrer"
          className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-full bg-[var(--brand)] px-3 py-2 text-xs font-medium text-[var(--on-brand)] transition-colors hover:bg-[var(--brand-hover)]"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open calendar event
        </a>
      )}

      {!!appointment.attendees?.length && (
        <div className="mb-3">
          <p className="plat-eyebrow mb-1">Invited</p>
          <p className="text-[11px] leading-relaxed text-[var(--text-3)]">
            {appointment.attendees.join(', ')}
          </p>
        </div>
      )}

      {/* Retry history */}
      {(attempts.length > 0 || appointment.retry_count > 0) && (
        <div>
          <p className="plat-eyebrow mb-1 flex items-center gap-1.5">
            <RefreshCw className="h-3 w-3" />
            Attempts
          </p>
          {attempts.length > 0 ? (
            <ul className="space-y-1">
              {attempts.map((a) => (
                <li key={a.attempt} className="flex items-baseline gap-2 text-[11px] text-[var(--text-4)]">
                  <span className="font-mono text-[var(--text-5)]">#{a.attempt}</span>
                  <span className="min-w-0 flex-1">
                    {a.at ? new Date(a.at).toLocaleString() : 'time not recorded'}
                    {a.outcome && <span className="ml-1.5 text-[var(--text-3)]">— {humanizeCode(a.outcome)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-[var(--text-4)]">
              Re-dialed {appointment.retry_count} time{appointment.retry_count === 1 ? '' : 's'}
              {appointment.max_retries ? ` of ${appointment.max_retries} allowed` : ''}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
