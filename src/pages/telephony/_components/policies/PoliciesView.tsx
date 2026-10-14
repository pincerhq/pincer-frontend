/**
 * Call policies — the rails the backend actually enforces.
 *
 * This screen used to be a form of sliders that saved nothing: retention days,
 * cost ceilings, approval thresholds, all local state with a Save button that
 * only flashed green. Everything here now reads from the server, and the one
 * thing that can be changed from a browser — the do-not-call list — really
 * changes it. What the backend does not expose says so instead of offering a
 * control that lies.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Loader2, Plus, Shield, ShieldCheck, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  useAddDoNotCall,
  useDoNotCall,
  useRemoveDoNotCall,
  useVoiceConnected,
  useVoiceStatus,
  type DoNotCallEntry,
  type VoiceStatus,
} from '@/lib/api/voice';
import PolicyPanel from '@/pages/telephony/_components/voice/PolicyPanel';
import { useCapabilities } from '@/lib/capabilities';

function Section({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-[var(--line-soft)] bg-[var(--paper)] p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
          <Icon className="h-4 w-4 text-[var(--text-5)]" />
          {title}
        </h2>
        {hint && <span className="text-[11px] text-[var(--text-3)]">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** A fact the server reports and the dashboard cannot change. */
function Fact({ label, value, tone = 'plain' }: { label: string; value: string; tone?: 'plain' | 'ok' | 'warn' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-[var(--line-soft)] py-2 first:border-t-0">
      <span className="text-[12px] text-[var(--text-3)]">{label}</span>
      <span
        className={cn(
          'shrink-0 text-[12px] font-medium',
          tone === 'ok' ? 'text-green-700' : tone === 'warn' ? 'text-amber-700' : 'text-[var(--ink)]',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function DoNotCallRow({ entry, onRemove, busy }: { entry: DoNotCallEntry; onRemove: () => void; busy: boolean }) {
  return (
    <li className="flex items-center gap-3 border-t border-[var(--line-soft)] py-2 first:border-t-0">
      <Ban className="h-3.5 w-3.5 shrink-0 text-[var(--text-5)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[12px] text-[var(--ink)]">{entry.phone_number}</span>
        {(entry.reason || entry.source) && (
          <span className="block truncate text-[11px] text-[var(--text-5)]">
            {[entry.reason, entry.source && `via ${entry.source}`].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        className="rounded-full p-1.5 text-[var(--text-5)] transition-colors hover:bg-[var(--sand)] hover:text-[var(--ink)] disabled:opacity-40"
        aria-label={`Remove ${entry.phone_number} from the do-not-call list`}
        title="Remove"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function DoNotCallSection() {
  const { toast } = useToast();
  const { data, isLoading, isError, error } = useDoNotCall();
  const add = useAddDoNotCall();
  const remove = useRemoveDoNotCall();

  const [number, setNumber] = useState('');
  const [reason, setReason] = useState('');

  const entries = useMemo(
    () => [...(data ?? [])].sort((a, b) => a.phone_number.localeCompare(b.phone_number)),
    [data],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const phone_number = number.trim();
    if (!phone_number) return;
    add.mutate(
      { phone_number, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      {
        onSuccess: () => {
          toast({ title: 'Added to the do-not-call list', description: phone_number });
          setNumber('');
          setReason('');
        },
        // E.164 validation is the server's; its sentence names the format.
        onError: (err) =>
          toast({ title: 'Not added', description: err.message, variant: 'destructive' }),
      },
    );
  };

  const drop = (entry: DoNotCallEntry) =>
    remove.mutate(entry.phone_number, {
      onSuccess: () => toast({ title: 'Removed', description: entry.phone_number }),
      onError: (err) => toast({ title: 'Not removed', description: err.message, variant: 'destructive' }),
    });

  return (
    <Section
      icon={Ban}
      title="Do not call"
      hint="the agent refuses these numbers before dialling"
    >
      <form onSubmit={submit} className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="+4930123456"
          aria-label="Phone number to block"
          className="h-9 w-48 bg-[var(--paper)] text-xs"
        />
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          aria-label="Reason"
          className="h-9 w-56 bg-[var(--paper)] text-xs"
        />
        <button
          type="submit"
          disabled={!number.trim() || add.isPending}
          className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--ink)] px-3.5 text-xs font-medium text-[var(--on-ink)] transition-opacity hover:opacity-85 disabled:opacity-40"
        >
          {add.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add
        </button>
      </form>

      {isLoading ? (
        <p className="text-xs text-[var(--text-3)]">Loading the list…</p>
      ) : isError ? (
        <p className="text-xs text-[var(--text-3)]">
          {error?.status === 404
            ? 'This backend has no do-not-call endpoint yet.'
            : (error?.message ?? 'The list could not be loaded.')}
        </p>
      ) : !entries.length ? (
        <p className="text-xs text-[var(--text-3)]">
          Nobody has opted out. Numbers land here when a caller asks not to be called again, or when
          you add one.
        </p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <DoNotCallRow
              key={entry.phone_number}
              entry={entry}
              onRemove={() => drop(entry)}
              busy={remove.isPending}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function ConsentSection() {
  const { data: status } = useVoiceStatus();
  const { i18n } = useTranslation();
  const de = i18n.language?.startsWith('de');

  const consent = status?.consent_mode ?? '';
  const twoParty = consent === 'two_party';

  return (
    <Section icon={ShieldCheck} title="Consent & announcement" hint="set on the server, not here">
      <Fact
        label="Consent mode"
        value={consent ? consent.replace('_', ' ') : '—'}
        tone={twoParty ? 'ok' : 'plain'}
      />
      <Fact
        label="Outbound calling"
        value={status?.outbound_enabled ? 'enabled' : 'off'}
        tone={status?.outbound_enabled ? 'plain' : 'warn'}
      />
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-3)]">
        {twoParty
          ? de
            ? 'Zwei-Parteien-Zustimmung: Der Agent holt zu Beginn des Gesprächs eine Bestätigung ein.'
            : 'Two-party consent: the agent asks for confirmation at the start of the call.'
          : de
            ? 'Ein-Parteien-Zustimmung: Der Agent kündigt an, dass er ein KI-Assistent ist.'
            : 'One-party consent: the agent announces that it is an AI assistant.'}{' '}
        {de
          ? 'Änderbar nur über die Server-Konfiguration (PINCER_VOICE_CONSENT_MODE).'
          : 'Changed on the server only (PINCER_VOICE_CONSENT_MODE).'}
      </p>
    </Section>
  );
}

// ── Limits the server enforces but does not expose ───────────────────
//
// These are real settings — the names, ranges and defaults below come from
// `pincer.config.channels` — but there is no API to read the value this
// deployment is actually running, let alone change it. So they are shown as
// what they are: the documented knob and its default, badged, with the
// environment variable that sets it. Guessing that the default is the live
// value would be worse than saying nothing.

interface KnobSpec {
  label: string;
  env: string;
  fallback: string;
  hint: string;
  /** Filled in from the server where an endpoint happens to carry it. */
  live?: string | null;
}

function Knob({ spec }: { spec: KnobSpec }) {
  const known = spec.live != null && spec.live !== '';
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-[var(--line-soft)] py-2.5 first:border-t-0">
      <span className="min-w-0">
        <span className="block text-[12px] text-[var(--text-2)]">{spec.label}</span>
        <span className="block text-[11px] text-[var(--text-5)]">{spec.hint}</span>
        <span className="mt-0.5 block font-mono text-[10.5px] text-[var(--text-5)]">{spec.env}</span>
      </span>
      <span className="shrink-0 text-right">
        <span
          className={cn(
            'block font-mono text-[12px]',
            known ? 'text-[var(--ink)]' : 'text-[var(--text-4)]',
          )}
        >
          {known ? spec.live : spec.fallback}
        </span>
        <span className="block text-[10px] text-[var(--text-5)]">
          {known ? 'live' : 'default'}
        </span>
      </span>
    </div>
  );
}

function LimitsSection({ status }: { status: VoiceStatus | undefined }) {
  // Two of these the status endpoint can already answer; the rest cannot be
  // read from anywhere, and the difference is labelled per row.
  const knobs: KnobSpec[] = [
    {
      label: 'Max call duration',
      env: 'PINCER_VOICE_MAX_CALL_DURATION',
      fallback: '600 s',
      hint: 'the call is ended after this, whatever is being said',
    },
    {
      label: 'Max hold time',
      env: 'PINCER_VOICE_MAX_HOLD_TIME',
      fallback: '300 s',
      hint: 'how long the agent waits in an IVR queue',
    },
    {
      label: 'Outbound calls per day',
      env: 'PINCER_VOICE_DAILY_CALL_LIMIT',
      fallback: '20',
      hint: 'server-wide cap, across every user and channel',
      live:
        status?.daily_calls_limit != null
          ? `${status.daily_calls_used ?? 0} / ${status.daily_calls_limit}`
          : null,
    },
    {
      label: 'Outbound calls per user per day',
      env: 'PINCER_VOICE_OUTBOUND_MAX_DAILY',
      fallback: '10',
      hint: 'the per-caller share of that cap',
    },
    {
      label: 'Quiet hours',
      env: 'PINCER_VOICE_QUIET_HOURS',
      fallback: '20:00–08:00',
      hint: 'no outbound calls in this local-time window',
      live: status?.quiet_hours_active
        ? `active until ${status.quiet_hours_until ?? '—'}`
        : status?.quiet_hours_active === false
          ? 'not active now'
          : null,
    },
    {
      label: 'Redial attempts',
      env: 'PINCER_VOICE_RETRY_ATTEMPTS',
      fallback: '2',
      hint: 'automatic retries after voicemail or no answer',
    },
  ];

  return (
    <Section icon={Shield} title="Hard limits" hint="rows marked live come from /api/voice/status">
      <div className="rounded-[10px] border border-[var(--line-soft)] bg-[var(--paper)] px-4 py-1">
        {knobs.map((spec) => (
          <Knob key={spec.env} spec={spec} />
        ))}
      </div>
    </Section>
  );
}

function RetentionSection() {
  const knobs: KnobSpec[] = [
    {
      label: 'Transcript retention',
      env: 'PINCER_VOICE_TRANSCRIPT_RETENTION_DAYS',
      fallback: '90 days',
      hint: 'after this the transcript is purged; the call row stays (0 = keep forever)',
    },
    {
      label: 'Call recording',
      env: 'PINCER_VOICE_RECORDING_ENABLED',
      fallback: 'off',
      hint: 'recording is a separate decision from live monitoring',
    },
    {
      label: 'Approval mode for write tools',
      env: 'PINCER_VOICE_TOOL_APPROVAL',
      fallback: 'verbal',
      hint: 'auto · verbal · user · off — what a Tier W tool needs mid-call',
    },
    {
      label: 'Per-tool overrides',
      env: 'PINCER_VOICE_TOOL_APPROVAL_OVERRIDES',
      fallback: 'none',
      hint: 'tool_name:mode pairs, e.g. payments.refund:user',
    },
  ];

  return (
    <Section icon={ShieldCheck} title="Retention & approvals" hint="enforced server-side">
      <div className="rounded-[10px] border border-[var(--line-soft)] bg-[var(--paper)] px-4 py-1">
        {knobs.map((spec) => (
          <Knob key={spec.env} spec={spec} />
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-5)]">
        PII masking is not a setting: every read surface on this API masks phone numbers and
        addresses before they leave the server.
      </p>
    </Section>
  );
}

export default function PoliciesView() {
  // FE10: no endpoint reports or sets these values; the blocks show only when the backend declares `limits_api`.
  const limitsDeclared = useCapabilities().isDeclared('limits_api');
  const connected = useVoiceConnected();
  const { data: status } = useVoiceStatus();

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-[var(--line-soft)] px-6 pb-4 pt-5">
        <p className="plat-crumb" style={{ color: 'var(--text-4)' }}>
          3days.telephony
        </p>
        <h1 className="mt-1 text-[26px] text-[var(--ink)]">Call policies</h1>
        <p className="mt-1 text-xs text-[var(--text-4)]">
          What the agent is allowed to do on a call — as the server enforces it
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-6">
        {!connected ? (
          <p className="text-sm text-[var(--text-4)]">
            Connect this browser to a Pincer backend to see the policies it enforces.
          </p>
        ) : (
          <>
            <DoNotCallSection />

            <Section icon={Shield} title="In-call tool policy" hint="resolved server-side, read-only">
              <PolicyPanel />
            </Section>

            <ConsentSection />

            {limitsDeclared && <LimitsSection status={status} />}
            {limitsDeclared && <RetentionSection />}
          </>
        )}
      </div>
    </div>
  );
}
