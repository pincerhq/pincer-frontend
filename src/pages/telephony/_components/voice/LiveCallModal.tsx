/**
 * One call while it is happening. The rail is ordered by urgency rather than by
 * data model: approvals waiting on you, live signals, the booking in progress,
 * what the agent has already done, then who is on the other end.
 *
 * REAL: header facts from /api/voice/active, transcript and actions polled from
 * /api/voice/calls/{sid} every 2s, approvals over the v3 stream, model switch
 * applied to the agent's next turn.
 *
 * MOCKED (badged): listen-in and whisper. No media proxy yet.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  CalendarClock,
  Check,
  ClipboardCopy,
  Cpu,
  Headphones,
  MessageSquare,
  ShieldQuestion,
  Zap,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  useAddToBlocklist,
  useCallHistoryAll,
  useDecideApproval,
  useLiveCallDetail,
  useMessages,
  usePendingApprovals,
  useUpdateVoiceConfig,
  useVoiceConfig,
  useVoiceStatus,
  type ActiveCall,
  type ApprovalState,
  type CallOutcome,
  type CallSummary,
} from '@/lib/api/voice';
import { useCapabilities } from '@/lib/capabilities';
import { LanguageSwitchDivider, LanguageFlag } from '@/pages/telephony/_components/voice/CallChips';
import AppointmentPanel from '@/pages/telephony/_components/voice/AppointmentPanel';
import CallActionsTimeline from '@/pages/telephony/_components/voice/CallActionsTimeline';
import { parseOutcome } from '@/pages/telephony/_components/voice/CallOutcomePanel';
import PlatSelect from '@/pages/telephony/_components/shared/PlatSelect';
import {
  CHIP_TONE_CLASS,
  fmtCostUsd,
  fmtMs,
  intentMeta,
  languageNative,
  latencyTone,
  outcomeTone,
  humanizeCode,
  parseLanguageSwitch,
} from '@/pages/telephony/_lib/voiceMeta';
import { msRemaining } from '@/components/voice/ApprovalCard';
import { useClaimCallApprovals } from '@/components/voice/approvalFocus';
import EndCallButton from '@/components/voice/EndCallButton';
import { cn } from '@/lib/utils';

function fmtDuration(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function fmtTime(ts: string) {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleTimeString();
}

/** Rail section: eyebrow, body, same rhythm throughout. */
function Section({
  title,
  hint,
  children,
  tone = 'plain',
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  tone?: 'plain' | 'urgent';
}) {
  return (
    <section
      className={cn(
        'rounded-[12px] border p-3',
        tone === 'urgent'
          ? 'border-amber-300 bg-amber-50/70'
          : 'border-[var(--line-soft)] bg-[var(--paper)]',
      )}
    >
      <div className="mb-2 flex items-baseline gap-2">
        <p className="plat-eyebrow">{title}</p>
        {hint && <span className="text-[10px] text-[var(--text-5)]">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Signal({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div title={title}>
      <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-5)]">{label}</p>
      <p className="mt-0.5 text-[13px] font-medium text-[var(--ink)]">{value}</p>
    </div>
  );
}

// ── Approvals waiting on this call ───────────────────────────────────

function LiveApprovals({ callSid }: { callSid: string }) {
  // While this is mounted the floating card stands down for this call.
  useClaimCallApprovals(callSid);
  const { approvals } = usePendingApprovals();
  const decide = useDecideApproval();
  const [settled, setSettled] = useState<Record<string, ApprovalState>>({});
  const [busy, setBusy] = useState<Record<string, 'approve' | 'deny'>>({});
  const [, force] = useState(0);

  const mine = approvals.filter((a) => a.call_sid === callSid);

  // Tick the countdown while a row is on screen.
  useEffect(() => {
    if (!mine.length) return;
    const t = setInterval(() => force((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, [mine.length]);

  if (!mine.length) return null;

  const onDecide = (id: string, decision: 'approve' | 'deny') => {
    setBusy((b) => ({ ...b, [id]: decision }));
    decide.mutate(
      { id, decision },
      {
        onSuccess: (out) => setSettled((s) => ({ ...s, [id]: out.state })),
        onError: (err) =>
          err.status === 409
            ? setSettled((s) => ({ ...s, [id]: err.state ?? 'expired' }))
            : setBusy(({ [id]: _drop, ...rest }) => rest),
      },
    );
  };

  return (
    <Section title="Waiting on you" hint="the caller is holding" tone="urgent">
      <div className="space-y-2">
        {mine.map((a) => {
          const state = settled[a.id];
          const seconds = Math.ceil(msRemaining(a.expires_at) / 1000);
          return (
            <div key={a.id} data-testid="live-approval" className="rounded-[10px] bg-[var(--paper)] p-2.5">
              <div className="flex items-start gap-2">
                <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
                <p className="min-w-0 flex-1 text-xs font-medium text-[var(--ink)]">{a.summary}</p>
                {!state && (
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-amber-700">{seconds}s</span>
                )}
              </div>
              <p className="mt-1 pl-5 font-mono text-[10px] text-[var(--text-5)]">{a.tool_name}</p>
              {state ? (
                <p className="mt-1.5 pl-5 text-[11px] font-medium text-[var(--text-3)]">{state}</p>
              ) : (
                <div className="mt-2 flex gap-1.5 pl-5">
                  <button
                    type="button"
                    disabled={!!busy[a.id]}
                    onClick={() => onDecide(a.id, 'approve')}
                    className="rounded-full bg-[var(--brand)] hover:bg-[var(--brand-hover)] px-3 py-1 text-[11px] font-semibold text-[var(--on-brand)] disabled:opacity-40"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={!!busy[a.id]}
                    onClick={() => onDecide(a.id, 'deny')}
                    className="rounded-full border border-[var(--line)] px-3 py-1 text-[11px] font-semibold text-[var(--text-2)] disabled:opacity-40"
                  >
                    Deny
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ── Outcome extracted so far ─────────────────────────────────────────

function OutcomeSoFar({ outcome }: { outcome: CallOutcome }) {
  return (
    <Section title="Outcome so far" hint="updated as the agent extracts it">
      <span
        className={cn(
          'inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium',
          CHIP_TONE_CLASS[outcomeTone(outcome.outcome)],
        )}
      >
        {humanizeCode(outcome.outcome)}
      </span>
      {outcome.task_result && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-2)]">{outcome.task_result}</p>
      )}
      {!!outcome.key_facts?.length && (
        <ul className="mt-2 space-y-1">
          {outcome.key_facts.map((f, i) => (
            <li key={i} className="flex gap-1.5 text-[11px] text-[var(--text-3)]">
              <span className="text-[var(--text-5)]">·</span>
              {f}
            </li>
          ))}
        </ul>
      )}
      {!!outcome.commitments?.length && (
        <div className="mt-2 border-t border-[var(--line-soft)] pt-2">
          <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-[var(--text-5)]">Promised</p>
          {outcome.commitments.map((c, i) => (
            <p key={i} className="text-[11px] text-[var(--text-3)]">
              <span className="font-medium text-[var(--text-2)]">{c.who || 'someone'}</span> — {c.what}
              {c.when ? ` (${c.when})` : ''}
            </p>
          ))}
        </div>
      )}
    </Section>
  );
}

// ── Who is on the other end ──────────────────────────────────────────

function CallerContext({ number, callSid }: { number: string; callSid: string }) {
  const { calls } = useCallHistoryAll();
  const { data: messages } = useMessages({ limit: 50 });
  const block = useAddToBlocklist();
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [copied, setCopied] = useState(false);

  const previous = useMemo(
    () =>
      calls.filter(
        (c: CallSummary) =>
          c.call_sid !== callSid && (c.from_number === number || c.to_number === number),
      ),
    [calls, number, callSid],
  );
  const last = previous[0];
  const fromThisCaller = (messages?.messages ?? []).filter((m) => m.caller_number === number);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      /* clipboard blocked; the number is on screen anyway */
    }
  };

  return (
    <Section title="This caller">
      <p className="font-mono text-xs text-[var(--ink)]">{number}</p>

      <div className="mt-2 space-y-1 text-[11px] text-[var(--text-4)]">
        <p>
          {previous.length
            ? `${previous.length} previous call${previous.length === 1 ? '' : 's'}`
            : 'First call from this number'}
          {last?.outcome?.outcome ? ` · last: ${humanizeCode(last.outcome.outcome)}` : ''}
        </p>
        {fromThisCaller.length > 0 && (
          <p>
            {fromThisCaller.length} message{fromThisCaller.length === 1 ? '' : 's'} in the inbox
          </p>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-3)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
        >
          {copied ? <Check className="h-3 w-3" /> : <ClipboardCopy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy number'}
        </button>

        {confirmBlock ? (
          <>
            <button
              type="button"
              onClick={() => {
                block.mutate({ number, reason: 'blocked during a live call' });
                setConfirmBlock(false);
              }}
              className="rounded-full bg-[var(--bad-fill)] px-2.5 py-1 text-[11px] font-semibold text-[var(--on-bad-fill)]"
            >
              Block for good
            </button>
            <button
              type="button"
              onClick={() => setConfirmBlock(false)}
              className="text-[11px] text-[var(--text-5)] hover:text-[var(--ink)]"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmBlock(true)}
            title="Blocks future calls from this number — it does not end this one"
            className="flex items-center gap-1 rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-3)] hover:border-[var(--bad-fg)] hover:text-[var(--bad-fg)]"
          >
            <Ban className="h-3 w-3" />
            {block.isSuccess ? 'Blocked' : 'Block caller'}
          </button>
        )}
      </div>
    </Section>
  );
}

// ── The modal ────────────────────────────────────────────────────────

export default function LiveCallModal({
  call,
  onClose,
}: {
  call: ActiveCall;
  onClose: () => void;
}) {
  // FE10: call controls need a media proxy + control endpoint; shown only when the backend declares `call_controls`.
  const controlsDeclared = useCapabilities().isDeclared('call_controls');
  const { data: detail } = useLiveCallDetail(call.call_sid);
  const { data: status } = useVoiceStatus();
  const { data: cfg } = useVoiceConfig();
  const updateModel = useUpdateVoiceConfig();
  const feedRef = useRef<HTMLDivElement>(null);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const lineCount = detail?.transcript.length ?? 0;

  /**
   * Follow the conversation, but only while the reader is already at the
   * bottom: yanking the view back mid-call is how you lose the line you were
   * reading, and this transcript grows every few seconds.
   */
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < 160) el.scrollTop = el.scrollHeight;
  }, [lineCount]);

  const who = call.target_name || call.target_number || call.caller_number;
  const peer = call.direction === 'outbound' ? call.target_number : call.caller_number;

  // The language in use: a mid-call switch wins over the call's own.
  const currentLanguage = useMemo(() => {
    const switches = (detail?.transcript ?? []).map(parseLanguageSwitch).filter(Boolean);
    return switches.length ? switches[switches.length - 1]!.to : detail?.language ?? null;
  }, [detail]);

  const outcome = useMemo(() => {
    for (const a of [...(detail?.actions ?? [])].reverse()) {
      const parsed = parseOutcome(a);
      if (parsed) return parsed;
    }
    return null;
  }, [detail]);

  const toolActions = useMemo(
    () => (detail?.actions ?? []).filter((a) => !parseOutcome(a)),
    [detail],
  );

  const lastTurn = detail?.latency?.per_turn?.at(-1);
  const latencyMs = lastTurn?.total_ms ?? detail?.latency?.p50_ms ?? null;

  const copyTranscript = async () => {
    const text = (detail?.transcript ?? [])
      .map((t) => `[${fmtTime(t.timestamp)}] ${t.speaker}: ${t.text}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTranscript(true);
      setTimeout(() => setCopiedTranscript(false), 1_500);
    } catch {
      /* clipboard blocked */
    }
  };

  const controls = [
    { icon: Headphones, label: 'Listen in' },
    { icon: MessageSquare, label: 'Whisper to agent' },
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        data-testid="live-call-modal"
        className="flex h-[92vh] w-[96vw] max-w-[1440px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1440px]"
      >
        {/* Header — live facts */}
        <div className="border-b border-[var(--line-soft)] px-6 py-4">
          <DialogTitle className="flex flex-wrap items-center gap-2.5 text-base font-semibold text-[var(--ink)]">
            {call.direction === 'outbound' ? (
              <ArrowUpRight className="h-4 w-4 text-[var(--text-5)]" />
            ) : (
              <ArrowDownLeft className="h-4 w-4 text-[var(--text-5)]" />
            )}
            {who}
            <span className="flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
              live · {fmtDuration(call.duration_seconds)}
            </span>
            {currentLanguage && <LanguageFlag language={currentLanguage} />}
            {detail?.inbound_intent && (
              <span
                title={intentMeta(detail.inbound_intent)?.title}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                  CHIP_TONE_CLASS[intentMeta(detail.inbound_intent)?.tone ?? 'grey'],
                )}
              >
                {intentMeta(detail.inbound_intent)?.label}
              </span>
            )}
          </DialogTitle>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-4)]">
            <span className="max-w-lg truncate" title={call.purpose}>
              <span className="text-[var(--text-5)]">Purpose:</span> {call.purpose}
            </span>
            <span className="font-mono">{peer}</span>
            <span>{call.engine}</span>
            {status?.consent_mode && (
              <span title="Recording/consent mode configured on the server">
                consent: {status.consent_mode}
              </span>
            )}
            <span className="font-mono text-[var(--text-5)]">{call.call_sid}</span>
          </div>
        </div>

        {/* Body: transcript + the rail that matters while it is talking */}
        <div className="flex min-h-0 flex-1">
          <div ref={feedRef} className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-4">
            <p className="plat-eyebrow mb-3">Live transcript</p>
            {!detail || detail.transcript.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-[var(--text-5)]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                Waiting for the first finalized line…
              </div>
            ) : (
              <div className="space-y-2.5">
                {detail.transcript.map((t, i) => {
                  const sw = parseLanguageSwitch(t);
                  if (sw) return <LanguageSwitchDivider key={i} sw={sw} />;
                  return (
                    <div key={i} className="flex items-start gap-3">
                      <span className="w-[64px] shrink-0 pt-0.5 font-mono text-[10px] text-[var(--text-5)]">
                        {fmtTime(t.timestamp)}
                      </span>
                      <span
                        className={cn(
                          'w-14 shrink-0 pt-0.5 text-[10px] font-semibold uppercase tracking-wide',
                          t.speaker === 'agent' ? 'text-[var(--brand)]' : 'text-[var(--text-4)]',
                        )}
                      >
                        {t.speaker}
                      </span>
                      <span
                        className={cn(
                          'min-w-0 flex-1 text-sm leading-relaxed',
                          t.speaker === 'agent' ? 'text-[var(--text-2)]' : 'text-[var(--ink)]',
                        )}
                      >
                        {t.text}
                        {t.state === 'undelivered' && (
                          <span className="ml-2 text-[10px] text-amber-600">⚠ not delivered as audio</span>
                        )}
                      </span>
                    </div>
                  );
                })}
                <div className="flex items-center gap-2 pt-1 text-xs text-[var(--text-5)]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                  listening…
                </div>
              </div>
            )}
          </div>

          <aside className="w-[380px] shrink-0 space-y-3 overflow-y-auto overflow-x-hidden border-l border-[var(--line-soft)] bg-[color:color-mix(in_srgb,var(--ink)_1.5%,transparent)] p-4">
            <LiveApprovals callSid={call.call_sid} />

            <Section title="Live signals">
              <div className="grid grid-cols-2 gap-3">
                <Signal
                  label="Turn latency"
                  title="Last turn, or the call's median when the last turn is not timed yet"
                  value={
                    latencyMs == null ? (
                      '—'
                    ) : (
                      <span
                        className={cn(
                          'rounded-full border px-1.5 py-0.5 text-[11px]',
                          CHIP_TONE_CLASS[latencyTone(latencyMs)],
                        )}
                      >
                        {fmtMs(latencyMs)}
                      </span>
                    )
                  }
                />
                <Signal label="Turns" value={detail?.latency?.turns ?? lineCount} />
                <Signal
                  label="Cost so far"
                  value={detail?.cost_total_usd != null ? fmtCostUsd(detail.cost_total_usd) : '—'}
                />
                <Signal
                  label="Language"
                  value={currentLanguage ? languageNative(currentLanguage) : '—'}
                />
              </div>

              {cfg && (
                <div className="mt-3 border-t border-[var(--line-soft)] pt-2.5">
                  <p className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--text-5)]">
                    <Cpu className="h-3 w-3" />
                    Model answering
                  </p>
                  <PlatSelect
                    value={cfg.voice_turn_model}
                    onChange={(v) => updateModel.mutate(v)}
                    disabled={updateModel.isPending}
                    ariaLabel="Model answering live voice turns"
                    className="h-8 text-xs"
                  >
                    {cfg.choices.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </PlatSelect>
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-[var(--text-5)]">
                    <Zap className="h-3 w-3" />
                    Applies from the agent's next turn
                  </p>
                </div>
              )}
            </Section>

            {detail?.appointment && (
              <Section title="Booking in progress" hint="live">
                <AppointmentPanel appointment={detail.appointment} />
              </Section>
            )}

            {outcome && <OutcomeSoFar outcome={outcome} />}

            <Section title="Actions so far" hint={toolActions.length ? `${toolActions.length}` : undefined}>
              {!toolActions.length ? (
                <p className="text-xs text-[var(--text-5)]">No tool calls yet.</p>
              ) : (
                <CallActionsTimeline actions={toolActions} compact heading={false} />
              )}
            </Section>

            {peer && <CallerContext number={peer} callSid={call.call_sid} />}
          </aside>
        </div>

        {/* What works, and what visibly does not */}
        <div className="border-t border-[var(--line-soft)]">
          <div className="flex flex-wrap items-center gap-2 px-6 py-2.5">
            <button
              type="button"
              onClick={copyTranscript}
              disabled={!lineCount}
              className="flex items-center gap-1.5 rounded-full border border-[var(--line)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-3)] transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)] disabled:opacity-40"
            >
              {copiedTranscript ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
              {copiedTranscript ? 'Copied' : 'Copy transcript'}
            </button>
            {detail?.appointment && (
              <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-4)]">
                <CalendarClock className="h-3.5 w-3.5" />
                booking: {humanizeCode(detail.appointment.status)}
              </span>
            )}
          </div>

          {controlsDeclared && (
          <div className="border-t border-[var(--line-soft)] px-6 py-3">
            <div className="flex flex-wrap gap-2 opacity-60">
              {controls.map(({ icon: Icon, label }) => (
                <button
                  key={label}
                  type="button"
                  disabled
                  className="flex cursor-not-allowed items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--paper)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-3)]"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
              <EndCallButton callSid={call.call_sid} />
            </div>
          </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
