/**
 * Makes a finished call actionable.
 *
 * The v2 API returns the structured extraction as a top-level `outcome`
 * field; older calls carry the same thing as a JSON blob on an `outcome`
 * action. Both are read here, top-level first, and rendered as a readable
 * outcome card (REAL data). Under it is a follow-up toolbox so the business
 * can *do* something with the call:
 *
 *   REAL        Call again / Schedule appointment → the call composer, prefilled
 *   REAL        Email summary (mailto), copy summary
 *   DEMO badge  Create follow-up task, outcome tag (Resolved / Follow-up /
 *               Escalate) — persisted locally until the backend has endpoints.
 */
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Copy,
  Flag,
  Loader2,
  Mail,
  PhoneOutgoing,
  Sparkles,
} from 'lucide-react';
import { useCapabilities } from '@/lib/capabilities';
import { useToast } from '@/hooks/use-toast';
import { PincerError } from '@/lib/pincerClient';
import { generateCallSummary } from '@/lib/api/voice';
import { cn } from '@/lib/utils';
import { denyReasonText, fmtCostUsd, fmtMs } from '@/pages/telephony/_lib/voiceMeta';
import { useTranslation } from 'react-i18next';
import type {
  CallAction,
  CallDetail,
  CallOutcome,
  Commitment,
  FollowUpSuggestion,
} from '@/lib/api/voice';

// Re-exported for the components (and tests) that grew up importing them here.
export type { CallOutcome, Commitment, FollowUpSuggestion };
export {
  parseOutcome,
  outcomeOf,
  approvalStates,
  type ApprovalState,
} from '@/pages/telephony/_lib/outcome';
import StartCallModal from '@/pages/telephony/_components/voice/StartCallModal';
import PlatMenu from '@/pages/telephony/_components/shared/PlatMenu';
import {
  approvalStates,
  commitmentText,
  fmtWhen,
  outcomeOf,
  WHO_LABEL,
  type ApprovalState,
} from '@/pages/telephony/_lib/outcome';

// ── The structured outcome the agent writes at end of call ──────────
//
// Shape and normalisation live in `@/lib/api/voice` (normalizeOutcome), because
// the same records arrive two ways: as the v2 `outcome` field, and as a JSON
// blob on an `outcome` action for calls that predate it.

const TAG_KEY = 'voice.demo.callTags';
const FOLLOWUP_KEY = 'voice.demo.followups';

type CallTag = 'resolved' | 'follow_up' | 'escalated';

function loadTags(): Record<string, CallTag> {
  try {
    return JSON.parse(localStorage.getItem(TAG_KEY) ?? '{}');
  } catch {
    return {};
  }
}

const APPROVAL_MARK: Record<ApprovalState, { mark: string; cls: string; title: string }> = {
  executed: { mark: '✓ executed', cls: 'text-green-600', title: 'Confirmed and carried out on the call' },
  denied: { mark: '✗ denied', cls: 'text-red-500', title: 'Refused when the agent asked' },
  pending: { mark: 'pending', cls: 'text-[var(--text-5)]', title: 'Suggested, not acted on yet' },
};

function OutcomeCard({
  outcome,
  approvals,
  detail,
  onCopy,
  onEmail,
  onGenerate,
  copied,
  generating,
  aiSummary,
}: {
  outcome: CallOutcome;
  approvals: Record<string, ApprovalState>;
  detail: CallDetail;
  onCopy: () => void;
  onEmail: () => void;
  onGenerate: () => void;
  copied: boolean;
  generating: boolean;
  aiSummary: string | null;
}) {
  const ok = outcome.outcome === 'completed';
  // Collapsed by default: the rail answers "how did it go" in four lines, and
  // expanding adds the rest plus the actions that act on the summary.
  const [open, setOpen] = useState(false);
  const [aiCopied, setAiCopied] = useState(false);
  const { i18n } = useTranslation();

  const denied = detail.actions.filter(
    (a) => a.action_type !== 'outcome' && (a.user_confirmed === false || a.deny_reason),
  ).length;
  const facts = outcome.key_facts ?? [];
  const shownFacts = open ? facts : facts.slice(0, 2);

  return (
    <div className="rounded-[10px] border border-[var(--line)] bg-white p-3" data-testid="outcome-card">
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            ok ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700',
          )}
        >
          <CheckCircle2 className="h-3 w-3" />
          {outcome.outcome}
        </span>
        {outcome.language && (
          <span className="rounded-full border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--text-5)]">
            {outcome.language}
          </span>
        )}
      </div>
      {outcome.task_result && (
        <p className={cn('text-xs leading-relaxed text-[var(--text-2)]', !open && 'line-clamp-4')}>
          {outcome.task_result}
        </p>
      )}
      {!!outcome.key_facts?.length && (
        <div className="mt-2.5">
          <p className="plat-eyebrow mb-1">
            Key facts
          </p>
          <ul className="space-y-1">
            {shownFacts.map((fact, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-[var(--text-3)]">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--text-5)]" />
                {fact}
              </li>
            ))}
          </ul>
          {!open && facts.length > shownFacts.length && (
            <p className="mt-1 pl-2.5 text-[11px] text-[var(--text-5)]">
              +{facts.length - shownFacts.length} more
            </p>
          )}
        </div>
      )}
      {!!outcome.commitments?.length && (
        <div className="mt-2.5">
          <p className="plat-eyebrow mb-1">
            Commitments made
          </p>
          <ul className="space-y-1">
            {outcome.commitments.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs font-medium text-[var(--ink)]">
                <Flag className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                <span className="min-w-0">
                  {c.who && (
                    <span className="font-normal text-[var(--text-4)]">{WHO_LABEL[c.who] ?? c.who}: </span>
                  )}
                  {c.what}
                  {c.when && (
                    <span className="ml-1 whitespace-nowrap font-normal text-[var(--text-5)]">
                      ({fmtWhen(c.when)})
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!outcome.follow_up_suggestions?.length && (
        <div className="mt-2.5">
          <p className="plat-eyebrow mb-1">
            Suggested follow-ups
          </p>
          <ul className="space-y-1">
            {outcome.follow_up_suggestions.map((sugg, i) => {
              const state = sugg.tool ? approvals[sugg.tool] : undefined;
              const mark = state ? APPROVAL_MARK[state] : null;
              return (
                <li key={i} className="flex items-start gap-1.5 text-xs text-[var(--text-3)]">
                  <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-[var(--brand)]" />
                  <span className="min-w-0">
                    {sugg.reason || sugg.tool}
                    {sugg.reason && sugg.tool && (
                      <span className="ml-1.5 font-mono text-[10px] text-[var(--text-5)]">{sugg.tool}</span>
                    )}
                    {mark && (
                      <span className={cn('ml-1.5 whitespace-nowrap text-[10px] font-medium', mark.cls)} title={mark.title}>
                        {mark.mark}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {open && (
        <>
          {/* What the summary does not say out loud */}
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[var(--line-soft)] pt-2.5">
            {[
              { label: 'Length', value: fmtCallLength(detail.duration_seconds) },
              {
                label: 'Cost',
                value: detail.cost_total_usd != null ? fmtCostUsd(detail.cost_total_usd) : '—',
              },
              {
                label: 'Turn latency',
                value: detail.latency?.p50_ms != null ? `${fmtMs(detail.latency.p50_ms)} p50` : '—',
              },
              {
                label: 'Tool calls',
                value:
                  detail.actions.filter((a) => a.action_type !== 'outcome').length === 0
                    ? 'none'
                    : `${detail.actions.filter((a) => a.action_type !== 'outcome').length}${denied ? ` · ${denied} refused` : ''}`,
              },
            ].map((row) => (
              <div key={row.label}>
                <dt className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-5)]">
                  {row.label}
                </dt>
                <dd
                  className={cn(
                    'text-xs font-medium',
                    row.label === 'Tool calls' && denied ? 'text-[var(--bad-fg)]' : 'text-[var(--ink)]',
                  )}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>

          {!!detail.actions.filter((a) => a.action_type !== 'outcome').length && (
            <div className="mt-3 border-t border-[var(--line-soft)] pt-2.5">
              <p className="plat-eyebrow mb-1">What the agent did</p>
              <ul className="space-y-1">
                {detail.actions
                  .filter((a) => a.action_type !== 'outcome')
                  .slice(0, 6)
                  .map((a, i) => {
                    const refused = a.user_confirmed === false || !!a.deny_reason;
                    return (
                      <li key={i} className="flex items-baseline gap-1.5 text-[11px]">
                        <span className="font-mono text-[var(--text-2)]">{a.tool_name}</span>
                        {a.input_summary && (
                          <span className="min-w-0 truncate text-[var(--text-5)]">{a.input_summary}</span>
                        )}
                        <span
                          className={cn(
                            'ml-auto shrink-0 font-medium',
                            refused ? 'text-[var(--bad-fg)]' : 'text-green-700',
                          )}
                          title={denyReasonText(a.deny_reason, i18n.language) ?? undefined}
                        >
                          {refused ? 'refused' : 'done'}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </div>
          )}

            {aiSummary && (
              <div className="rounded-[10px] border border-[var(--line)] bg-white p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="plat-eyebrow flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-[var(--brand)]" />
                    Agent summary
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(aiSummary);
                      setAiCopied(true);
                      setTimeout(() => setAiCopied(false), 1200);
                    }}
                    className="rounded p-1 text-[var(--text-5)] hover:bg-[var(--sand-deep)] hover:text-[var(--text-3)]"
                    aria-label="Copy agent summary"
                  >
                    {aiCopied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                  </button>
                </div>
                <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-[var(--text-2)]">
                  {aiSummary}
                </p>
              </div>
            )}

          {/* Actions on the summary: copy it, send it, rewrite it */}
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--line-soft)] pt-2.5">
            <button type="button" onClick={onCopy} className={summaryBtn}>
              {copied ? (
                <Check className="h-3 w-3 text-green-600" />
              ) : (
                <Copy className="h-3 w-3 text-[var(--text-5)]" />
              )}
              {copied ? 'Copied' : 'Copy summary'}
            </button>
            <button type="button" onClick={onEmail} className={summaryBtn}>
              <Mail className="h-3 w-3 text-[var(--text-5)]" />
              Email it
            </button>
            <button type="button" onClick={onGenerate} disabled={generating} className={summaryBtn}>
              {generating ? (
                <Loader2 className="h-3 w-3 animate-spin text-[var(--brand)]" />
              ) : (
                <Sparkles className="h-3 w-3 text-[var(--brand)]" />
              )}
              {generating ? 'Writing…' : aiSummary ? 'Rewrite with AI' : 'Write it with AI'}
            </button>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="outcome-expand"
        className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-[8px] py-1 text-[11px] font-medium text-[var(--text-4)] transition-colors hover:bg-[var(--sand)] hover:text-[var(--ink)]"
      >
        {open ? 'Less' : 'More details'}
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>
    </div>
  );
}

/** One style for every action on the summary. */
const summaryBtn =
  'flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-3)] transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)] disabled:opacity-40';

/** m:ss; the rail has no room for "3 minutes 20 seconds". */
function fmtCallLength(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

// ── Follow-up toolbox ───────────────────────────────────────────────

export default function CallOutcomePanel({ detail }: { detail: CallDetail }) {
  // FE10: follow-up actions exist only when the backend declares `followups`.
  const followupsDeclared = useCapabilities().isDeclared('followups');
  const { toast } = useToast();
  const outcome = useMemo(() => outcomeOf(detail), [detail]);
  const approvals = useMemo(
    () => approvalStates(detail.actions, outcome?.follow_up_suggestions ?? []),
    [detail.actions, outcome],
  );

  const number = detail.direction === 'outbound' ? detail.to_number : detail.from_number;
  const summary = outcome?.task_result ?? `Call ${detail.call_sid} (${detail.status})`;

  const [composer, setComposer] = useState<null | 'now' | 'appointment'>(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [tags, setTags] = useState<Record<string, CallTag>>(loadTags);
  const tag = tags[detail.call_sid];

  const setTag = (next: CallTag | null) => {
    const updated = { ...tags };
    if (next) updated[detail.call_sid] = next;
    else delete updated[detail.call_sid];
    setTags(updated);
    localStorage.setItem(TAG_KEY, JSON.stringify(updated));
  };

  const summaryText = () =>
    [
      `Call summary — ${detail.call_sid}`,
      `Number: ${number} · ${new Date(detail.started_at).toLocaleString()}`,
      '',
      summary,
      ...(outcome?.key_facts?.length ? ['', 'Key facts:', ...outcome.key_facts.map((f) => `- ${f}`)] : []),
      ...(outcome?.commitments?.length
        ? ['', 'Commitments:', ...outcome.commitments.map((c) => `- ${commitmentText(c)}`)]
        : []),
    ].join('\n');

  const copySummary = async () => {
    await navigator.clipboard.writeText(summaryText());
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const emailSummary = () => {
    const subject = encodeURIComponent(`Call summary · ${number}`);
    const body = encodeURIComponent(summaryText());
    window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
  };

  const createTask = () => {
    try {
      const list = JSON.parse(localStorage.getItem(FOLLOWUP_KEY) ?? '[]');
      list.unshift({
        id: crypto.randomUUID(),
        call_sid: detail.call_sid,
        number,
        summary,
        created: new Date().toISOString(),
      });
      localStorage.setItem(FOLLOWUP_KEY, JSON.stringify(list));
    } catch {
      /* best effort — it's a demo store */
    }
    toast({
      title: 'Follow-up task created (demo)',
      description: 'Saved locally — no task endpoint on the backend yet.',
    });
  };

  // REAL: the agent writes the summary — but through an isolated summarizer
  // identity, so the user's chat context can't bleed into the answer and the
  // request never lands in their conversation history.
  const generateSummary = async () => {
    if (generating) return;
    const lines = detail.transcript
      .map((t) => `${t.speaker.toUpperCase()}: ${t.text}`)
      .join('\n');
    if (!lines) {
      toast({ title: 'No transcript to summarize' });
      return;
    }
    setGenerating(true);
    try {
      const reply = await generateCallSummary(lines);
      setAiSummary(reply);
    } catch (err) {
      toast({
        title: 'Summary failed',
        description: err instanceof PincerError ? err.message : 'Could not reach the agent.',
        variant: 'destructive',
      });
    } finally {
      setGenerating(false);
    }
  };

  const tagOptions: { id: CallTag; label: string; icon: typeof Check }[] = [
    { id: 'resolved', label: 'Resolved', icon: Check },
    { id: 'follow_up', label: 'Follow-up', icon: ClipboardList },
    { id: 'escalated', label: 'Escalate', icon: AlertTriangle },
  ];

  return (
    <div className="space-y-3">
      {outcome && (
        <div>
          <p className="plat-eyebrow mb-2">Call outcome</p>
          <OutcomeCard
            outcome={outcome}
            approvals={approvals}
            detail={detail}
            onCopy={copySummary}
            onEmail={emailSummary}
            onGenerate={generateSummary}
            copied={copied}
            generating={generating}
            aiSummary={aiSummary}
          />
        </div>
      )}

      {/* The options open upwards: this sits at the foot of a scrolling rail. */}
      {followupsDeclared && (
      <div className="flex items-center gap-2 rounded-[10px] border border-[var(--line-soft)] bg-white px-3 py-2">
        <p className="plat-eyebrow truncate">Follow up on this call</p>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <PlatMenu
            ariaLabel="Follow-up options for this call"
            direction="up"
            sections={[
              {
                items: [
                  {
                    key: 'appointment',
                    label: 'Book a follow-up appointment',
                    icon: CalendarClock,
                    hint: <span className="text-green-700">real</span>,
                    onSelect: () => setComposer('appointment'),
                  },
                  {
                    key: 'call',
                    label: 'Call again now',
                    icon: PhoneOutgoing,
                    hint: <span className="text-green-700">real</span>,
                    onSelect: () => setComposer('now'),
                  },
                  {
                    key: 'task',
                    label: 'Create follow-up task',
                    icon: ClipboardList,
                    hint: 'demo',
                    onSelect: createTask,
                  },
                ],
              },
              {
                label: 'Mark this call',
                items: tagOptions.map(({ id, label, icon }) => ({
                  key: id,
                  label,
                  icon,
                  hint: 'demo',
                  selected: tag === id,
                  // Choosing the current tag again clears it, so a mis-tagged
                  // call can go back to untagged.
                  onSelect: () => setTag(tag === id ? null : id),
                })),
              },
            ]}
            footer="Task & tag are saved in this browser; the call and appointment options hit the real backend."
          />
        </div>
      </div>
      )}

      {composer && (
        <StartCallModal
          onClose={() => setComposer(null)}
          initialMode={composer}
          initialNumber={number}
          initialPurpose={`Follow-up on call ${detail.call_sid}: ${summary}`}
        />
      )}
    </div>
  );
}
