/**
 * The receptionist on the Voice page (S12 §4, §10.2, §13): what it tells
 * people, whether it is working, and how to stop one caller.
 *
 * Open/closed is computed in the business's timezone, not the browser's: an
 * owner checking from another country must not be told their office is closed.
 */
import { useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck,
  Clock3,
  Loader2,
  MessageSquareText,
  PhoneForwarded,
  Plus,
  ShieldBan,
  Trash2,
} from 'lucide-react';
import {
  useAddToBlocklist,
  useBlocklist,
  useReceptionistProfile,
  useReceptionistStats,
  type SentimentDistribution,
  useRemoveFromBlocklist,
  E164_HINT,
  E164_RE,
  INBOUND_INTENTS,
  type BusinessProfile,
} from '@/lib/api/voice';
import {
  CHIP_TONE_CLASS,
  intentMeta,
  isOpenNow,
  todayHoursLabel,
} from '@/pages/telephony/_lib/voiceMeta';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  MIN_ASSESSED_FOR_DISTRIBUTION,
  NOT_ENOUGH_CALLS,
  SENTIMENT,
  SENTIMENTS,
  SENTIMENT_HEADING,
  t,
} from '@/components/voice/analytics/sentimentCopy';

// ── Profile ──────────────────────────────────────────────────────────

function ProfileCard({ profile }: { profile: BusinessProfile }) {
  const open = isOpenNow(profile.hours ?? {}, profile.timezone);
  const hours = todayHoursLabel(profile.hours ?? {}, profile.timezone);

  return (
    <div className="rounded-[14px] border border-[var(--line-soft)] bg-[var(--paper)] p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="plat-eyebrow">Receptionist</p>
          <h3 className="mt-1 truncate text-[17px] font-semibold text-[var(--ink)]">{profile.name}</h3>
          <p className="mt-0.5 text-xs text-[var(--text-4)]">
            Answers in {profile.languages?.length ? profile.languages.join(', ').toUpperCase() : '—'} ·{' '}
            {profile.timezone}
          </p>
        </div>
        <span
          data-testid="receptionist-open-state"
          data-open={open ? 'true' : 'false'}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
            open ? CHIP_TONE_CLASS.green : CHIP_TONE_CLASS.grey,
          )}
          title={`Business hours are evaluated in ${profile.timezone}, not in your browser's timezone`}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', open ? 'bg-green-600' : 'bg-[var(--text-5)]')} />
          {open ? 'Open now' : 'Closed now'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--line-soft)] pt-4 text-xs sm:grid-cols-4">
        <div>
          <p className="flex items-center gap-1.5 text-[var(--text-5)]">
            <Clock3 className="h-3.5 w-3.5" /> Today
          </p>
          <p className="mt-1 font-medium text-[var(--text-1)]">{hours}</p>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-[var(--text-5)]">
            <CalendarCheck className="h-3.5 w-3.5" /> Booking
          </p>
          <p className="mt-1 font-medium text-[var(--text-1)]">
            {profile.booking?.enabled
              ? `on · ${profile.booking.duration_minutes ?? '—'} min slots`
              : 'off'}
          </p>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-[var(--text-5)]">
            <PhoneForwarded className="h-3.5 w-3.5" /> Transfer
          </p>
          <p className="mt-1 font-medium text-[var(--text-1)]">{profile.transfer?.enabled ? 'on' : 'off'}</p>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-[var(--text-5)]">
            <MessageSquareText className="h-3.5 w-3.5" /> Knows
          </p>
          <p className="mt-1 font-medium text-[var(--text-1)]">
            {profile.services_count ?? 0} services · {profile.faq_count ?? 0} FAQs
          </p>
        </div>
      </div>

      {profile.after_hours && (
        <p className="mt-3 text-[11px] text-[var(--text-4)]">
          After hours: <span className="text-[var(--text-2)]">{profile.after_hours}</span>
        </p>
      )}
    </div>
  );
}

// ── Stats ────────────────────────────────────────────────────────────

/** 0..1 is the contract; > 1 is read as already a percentage. */
function pct(v: number | null | undefined): string {
  if (v == null) return '—';
  const n = v > 1 ? v : v * 100;
  return `${Math.round(n)}%`;
}

function StatsStrip() {
  const [days, setDays] = useState<7 | 30>(7);
  const { data, isLoading, isError } = useReceptionistStats(days);

  const intentTotal = INBOUND_INTENTS.reduce((n, k) => n + (data?.intents?.[k] ?? 0), 0);

  return (
    <div className="rounded-[14px] border border-[var(--line-soft)] bg-[var(--paper)] p-5">
      <div className="mb-4 flex items-center gap-3">
        <p className="plat-eyebrow">Inbound</p>
        <div className="ml-auto flex rounded-full border border-[var(--line)] p-0.5">
          {([7, 30] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                days === d ? 'bg-[var(--ink)] text-[var(--on-ink)]' : 'text-[var(--text-4)] hover:text-[var(--ink)]',
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="flex items-center gap-2 text-xs text-[var(--text-4)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      ) : isError || !data ? (
        <p className="text-xs text-[var(--text-4)]">No receptionist metrics for this period.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: 'Answered', value: String(data.answered ?? 0) },
              { label: 'Messages taken', value: String(data.messages_taken ?? 0) },
              { label: 'Booking conversion', value: pct(data.booking_conversion) },
              { label: 'Transferred', value: pct(data.transfer_rate) },
            ].map((s) => (
              <div key={s.label}>
                <p className="text-[22px] font-semibold leading-none text-[var(--ink)]">{s.value}</p>
                <p className="mt-1 text-[11px] text-[var(--text-4)]">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Intent distribution, labelled below the bar */}
          {intentTotal > 0 && (
            <div className="mt-5">
              <p className="plat-eyebrow mb-2">Why they called</p>
              <div className="flex h-2 overflow-hidden rounded-full bg-[var(--sand-deep)]">
                {INBOUND_INTENTS.map((intent, i) => {
                  const n = data.intents?.[intent] ?? 0;
                  if (!n) return null;
                  return (
                    <div
                      key={intent}
                      title={`${intentMeta(intent)?.label}: ${n}`}
                      style={{
                        width: `${(n / intentTotal) * 100}%`,
                        background: `color-mix(in srgb, var(--brand) ${100 - i * 14}%, var(--sand-deep))`,
                        marginRight: 2,
                      }}
                    />
                  );
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {INBOUND_INTENTS.filter((i) => (data.intents?.[i] ?? 0) > 0).map((intent) => (
                  <span key={intent} className="text-[11px] text-[var(--text-4)]">
                    {intentMeta(intent)?.label}{' '}
                    <span className="font-mono text-[var(--text-2)]">{data.intents?.[intent]}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* How callers sounded (S16 §5). Only with a sample worth reading:
              "33% negative" out of three calls is a sentence that sounds like
              a trend and is not one. */}
          <SentimentDistributionBar distribution={data.sentiment_distribution} days={days} />

          {/* Failure signals: only when they happened, and then in amber */}
          {(data.busy_capacity > 0 || data.silent_hangups > 0) && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--line-soft)] pt-3">
              {data.busy_capacity > 0 && (
                <span
                  className={cn('rounded-full border px-2.5 py-1 text-[11px] font-medium', CHIP_TONE_CLASS.amber)}
                  title="Calls that hit the concurrent-call ceiling — callers heard busy"
                >
                  {data.busy_capacity} hit capacity
                </span>
              )}
              {data.silent_hangups > 0 && (
                <span
                  className={cn('rounded-full border px-2.5 py-1 text-[11px] font-medium', CHIP_TONE_CLASS.amber)}
                  title="Calls where the caller said nothing and hung up"
                >
                  {data.silent_hangups} silent hangups
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Blocklist ────────────────────────────────────────────────────────

function BlocklistSection() {
  const { data: entries, isLoading, isError } = useBlocklist();
  const add = useAddToBlocklist();
  const remove = useRemoveFromBlocklist();

  const [number, setNumber] = useState('');
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const submit = () => {
    const trimmed = number.trim();
    // Same pattern and same sentence as the server: two different rules is how
    // an owner learns to distrust both.
    if (!E164_RE.test(trimmed)) {
      setLocalError(E164_HINT);
      return;
    }
    setLocalError(null);
    add.mutate(
      { number: trimmed, reason: reason.trim() || 'blocked by owner' },
      {
        onSuccess: () => {
          setNumber('');
          setReason('');
        },
      },
    );
  };

  const error = localError ?? (add.isError ? add.error?.message : null);

  return (
    <div className="rounded-[14px] border border-[var(--line-soft)] bg-[var(--paper)] p-5">
      <p className="plat-eyebrow mb-3 flex items-center gap-1.5">
        <ShieldBan className="h-3.5 w-3.5" /> Blocked callers
      </p>

      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-[190px] flex-1">
          <input
            value={number}
            onChange={(e) => {
              setNumber(e.target.value);
              setLocalError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="+4930123456"
            aria-label="Number to block"
            aria-invalid={!!error}
            className="w-full rounded-[10px] border border-[var(--line)] bg-[var(--sand)] px-3 py-2 font-mono text-sm text-[var(--ink)] placeholder:text-[var(--text-5)]"
          />
        </div>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Reason (optional)"
          aria-label="Reason"
          className="min-w-[160px] flex-1 rounded-[10px] border border-[var(--line)] bg-[var(--sand)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--text-5)]"
        />
        <button
          type="button"
          onClick={submit}
          disabled={add.isPending}
          className="flex items-center gap-1.5 rounded-full bg-[var(--ink)] px-3.5 py-2 text-xs font-semibold text-[var(--on-ink)] disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          Block
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[11px] text-[var(--bad-fg)]">
          {error}
        </p>
      )}

      <div className="mt-4 border-t border-[var(--line-soft)] pt-3">
        {isLoading ? (
          <p className="text-xs text-[var(--text-4)]">Loading…</p>
        ) : isError ? (
          <p className="text-xs text-[var(--text-4)]">The backend has no blocklist endpoint yet.</p>
        ) : !entries?.length ? (
          <p className="text-xs text-[var(--text-5)]">Nobody is blocked.</p>
        ) : (
          <ul className="space-y-1.5">
            {entries.map((e) => (
              <li key={e.number} className="flex items-center gap-3 text-xs">
                <span className="font-mono text-[var(--text-1)]">{e.number}</span>
                <span className="min-w-0 flex-1 truncate text-[var(--text-4)]">{e.reason}</span>
                {e.source === 'suggested' && (
                  <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', CHIP_TONE_CLASS.amber)}>
                    suggested
                  </span>
                )}
                {confirming === e.number ? (
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        remove.mutate(e.number);
                        setConfirming(null);
                      }}
                      className="rounded-full bg-[var(--bad-fg)] px-2.5 py-1 text-[10px] font-semibold text-white"
                    >
                      Unblock
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="text-[10px] text-[var(--text-5)] hover:text-[var(--ink)]"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(e.number)}
                    aria-label={`Unblock ${e.number}`}
                    className="rounded-md p-1 text-[var(--text-5)] hover:text-[var(--bad-fg)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Panel ────────────────────────────────────────────────────────────

/** The window's sentiment split, or an honest "ask me again later". */
function SentimentDistributionBar({
  distribution,
  days,
}: {
  distribution: SentimentDistribution | undefined;
  days: number;
}) {
  const { i18n } = useTranslation();
  const lang = i18n.language;

  // An older backend sends no distribution at all: render nothing, not a zero.
  if (!distribution) return null;

  const assessed = distribution.assessed ?? 0;
  const heading = `${t(SENTIMENT_HEADING, lang)} (${days}d)`;

  if (assessed < MIN_ASSESSED_FOR_DISTRIBUTION) {
    return (
      <div className="mt-5">
        <p className="plat-eyebrow mb-2">{heading}</p>
        <p className="text-[11px] text-[var(--text-5)]">{t(NOT_ENOUGH_CALLS, lang)}</p>
      </div>
    );
  }

  const counts = SENTIMENTS.map((key) => ({ key, n: distribution[key] ?? 0 })).filter((s) => s.n > 0);

  return (
    <div className="mt-5">
      <p className="plat-eyebrow mb-2">{heading}</p>
      <div className="flex h-2 overflow-hidden rounded-full bg-[var(--sand-deep)]">
        {counts.map(({ key, n }) => (
          <div
            key={key}
            className={SENTIMENT[key].barClass}
            style={{ width: `${(n / assessed) * 100}%`, marginRight: 2 }}
            title={`${t(SENTIMENT[key].label, lang)}: ${n}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {counts.map(({ key, n }) => (
          <span key={key} className="flex items-center gap-1.5 text-[11px] text-[var(--text-4)]">
            <span className={cn('h-2 w-2 rounded-full', SENTIMENT[key].dotClass)} />
            {t(SENTIMENT[key].label, lang)} <span className="font-mono text-[var(--text-2)]">{n}</span>
          </span>
        ))}
        <span className="text-[11px] text-[var(--text-5)]">· {assessed} assessed</span>
      </div>
    </div>
  );
}

export default function ReceptionistPanel() {
  const { data, isLoading } = useReceptionistProfile();

  if (isLoading) return null;

  // Not configured is a state, not an error: one quiet line.
  if (!data || data.enabled !== true) {
    return (
      <p className="flex items-center gap-2 text-xs text-[var(--text-5)]">
        <AlertTriangle className="h-3.5 w-3.5" />
        Receptionist not configured.{' '}
        <a
          href="https://docs.pincer.sh/voice/receptionist"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[var(--text-3)] underline hover:text-[var(--ink)]"
        >
          How to set it up
        </a>
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="receptionist-panel">
      <ProfileCard profile={data} />
      <StatsStrip />
      <BlocklistSection />
    </div>
  );
}
