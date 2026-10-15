/**
 * What the agent did on the call, and by whose authority (S11 §9): the tool's
 * tier, the gate it went through, and the reason code as a sentence when it
 * was refused.
 *
 * Anything that ran with approvals off is also listed on its own, mirroring the
 * S11 §6.4 report rule: the dashboard and the Telegram report must not disagree
 * about what the agent did unsupervised.
 */
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Ban, Check } from 'lucide-react';
import type { CallAction } from '@/lib/api/voice';
import { CHIP_TONE_CLASS, denyReasonText, modeMeta, tierMeta } from '@/pages/telephony/_lib/voiceMeta';
import { cn } from '@/lib/utils';

function fmtTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Denied, in either of the two ways the backend can say it. */
export function isDenied(a: CallAction): boolean {
  return a.user_confirmed === false || !!a.deny_reason;
}

/** Ran with approvals off: the S11 §6.4 disclosure set. */
export function isAutonomous(a: CallAction): boolean {
  return (a.approval_mode ?? '').toLowerCase() === 'off' && !isDenied(a);
}

function TierChip({ action }: { action: CallAction }) {
  const denied = isDenied(action);
  const meta = tierMeta(action.tier);
  if (!meta) return null;
  return (
    <span
      title={denied ? `${meta.title} — refused` : meta.title}
      className={cn(
        'shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-semibold',
        denied ? CHIP_TONE_CLASS.red : meta.cls,
      )}
    >
      {meta.label}
    </span>
  );
}

function ModeChip({ action }: { action: CallAction }) {
  const meta = modeMeta(action.approval_mode);
  if (!meta) return null;
  return (
    <span
      title={meta.title}
      className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium', CHIP_TONE_CLASS[meta.tone])}
    >
      {meta.label}
    </span>
  );
}

export function ActionRow({ action, compact = false }: { action: CallAction; compact?: boolean }) {
  const { i18n } = useTranslation();
  const denied = isDenied(action);
  const reason = denyReasonText(action.deny_reason, i18n.language);

  return (
    <div
      data-testid="call-action-row"
      data-denied={denied ? 'true' : 'false'}
      className={cn(
        'text-xs',
        !compact && 'rounded-[10px] border border-[var(--line)] bg-[var(--paper)] p-3',
        compact && 'py-0.5',
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <TierChip action={action} />
        <ModeChip action={action} />
        <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-3)]">
          {action.action_type}
        </span>
        <span className="min-w-0 truncate font-medium text-[var(--ink)]">{action.tool_name}</span>
        {denied ? (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-[var(--bad-fg)]" title={reason ?? undefined}>
            <Ban className="h-3 w-3" /> denied
          </span>
        ) : action.user_confirmed === true ? (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-green-600">
            <Check className="h-3 w-3" /> confirmed
          </span>
        ) : null}
      </div>

      {action.input_summary && <div className="mt-1 text-[var(--text-4)]">{action.input_summary}</div>}
      {!compact && action.output_summary && (
        <div className="mt-0.5 text-[var(--text-5)]">→ {action.output_summary}</div>
      )}

      {denied && reason && (
        <p
          data-testid="deny-reason"
          title={reason}
          className="mt-1 rounded-[8px] border border-red-100 bg-red-50/60 px-2 py-1 text-[11px] text-red-800"
        >
          {reason}
        </p>
      )}

      {!compact && (
        <div className="mt-1 font-mono text-[10px] text-[var(--text-5)]">{fmtTime(action.timestamp)}</div>
      )}
    </div>
  );
}

/** The same list the Telegram report carries for this call (S11 §6.4). */
export function AutonomyDisclosure({ actions }: { actions: CallAction[] }) {
  const autonomous = actions.filter(isAutonomous);
  if (!autonomous.length) return null;

  return (
    <section
      data-testid="autonomy-disclosure"
      className="mt-4 rounded-[10px] border-2 border-amber-300 bg-amber-50/60 p-3"
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
        <AlertTriangle className="h-3.5 w-3.5" />
        Executed autonomously during this call
      </p>
      <p className="mt-0.5 text-[11px] text-amber-800/80">
        Approvals were switched off, so the agent ran {autonomous.length === 1 ? 'this' : 'these'}{' '}
        without asking anyone.
      </p>
      <ul className="mt-2 space-y-1.5">
        {autonomous.map((a, i) => (
          <li key={`${a.tool_name}-${i}`} className="text-[11px] text-amber-900">
            <span className="font-medium">{a.tool_name}</span>
            {a.input_summary && <span className="text-amber-900/75"> — {a.input_summary}</span>}
            <span className="ml-1.5 font-mono text-[10px] text-amber-900/60">{fmtTime(a.timestamp)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function CallActionsTimeline({
  actions,
  compact = false,
  heading = true,
}: {
  actions: CallAction[];
  compact?: boolean;
  /** Off where the surrounding panel already says "Actions" (the live rail). */
  heading?: boolean;
}) {
  if (!actions.length) return null;
  return (
    <div className={heading ? 'mt-4 border-t border-[var(--line-soft)] pt-3' : undefined}>
      {heading && (
        <h4 className="mb-2 text-xs font-semibold text-[var(--text-4)]">Actions ({actions.length})</h4>
      )}
      <div className={compact ? 'space-y-1.5' : 'space-y-3'}>
        {actions.map((a, i) => (
          <ActionRow key={`${a.tool_name}-${a.timestamp}-${i}`} action={a} compact={compact} />
        ))}
      </div>
      <AutonomyDisclosure actions={actions} />
    </div>
  );
}
