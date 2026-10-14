/**
 * One matter, end to end (S14 §3).
 *
 * The page answers three questions in order: what is this about and where does
 * it stand (header + rolling summary), who owes what (commitments), and what
 * actually happened (the call timeline). Everything below the summary is
 * evidence for the line above it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  PhoneOutgoing,
  Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/hooks/use-toast';
import {
  useCallDetail,
  usePatchThread,
  useThread,
  type ThreadCall,
  type ThreadDetail,
  type ThreadStatus,
} from '@/lib/api/voice';
import { LanguageFlag, OutcomeChip } from '@/pages/telephony/_components/voice/CallChips';
import CallDetailBody, { PurgedTranscriptNote } from '@/pages/telephony/_components/voice/CallDetailBody';
import SentimentDot from '@/components/voice/analytics/SentimentDot';
import StartCallModal from '@/pages/telephony/_components/voice/StartCallModal';
import { AttachGlyph, CommitmentRows, ThreadGlyph, ThreadStatusChip } from './ThreadBits';
import {
  STATUS_ACTION_LABEL,
  allowedTransitions,
  attachMeta,
  expiredCount,
  sortCommitments,
  spokenDate,
  threadRouteMissing,
} from '@/pages/telephony/_lib/threadMeta';
import { AssignCallModal, MergeThreadModal } from './ThreadManageModals';
import { followUpPurpose } from '@/pages/telephony/_lib/briefing';

const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
};

const fmtDuration = (s: number) => {
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
};

// ── Header ───────────────────────────────────────────────────────────

function SubjectField({ thread }: { thread: ThreadDetail }) {
  const { toast } = useToast();
  const patch = usePatchThread();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.subject);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(thread.subject);
  }, [thread.subject, editing]);

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  const commit = () => {
    const subject = draft.trim();
    setEditing(false);
    if (!subject || subject === thread.subject) return;
    // Optimistic in the hook; the rollback lands here as a toast (§3.1).
    patch.mutate(
      { id: thread.id, subject },
      {
        onError: (err) =>
          toast({ title: 'Could not rename the thread', description: err.message, variant: 'destructive' }),
      },
    );
  };

  if (editing) {
    return (
      <input
        ref={input}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(thread.subject);
            setEditing(false);
          }
        }}
        aria-label="Thread subject"
        className="w-full max-w-[640px] rounded-[10px] border border-[var(--line)] bg-[var(--paper)] px-2 py-1 text-[24px] text-[var(--ink)] outline-none focus:border-[var(--ink)]"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group flex max-w-full items-center gap-2 text-left"
      aria-label="Rename thread"
    >
      <ThreadGlyph className="text-[20px]" />
      <span className="truncate text-[26px] text-[var(--ink)]">{thread.subject}</span>
      <Pencil className="h-3.5 w-3.5 shrink-0 text-[var(--text-5)] opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function ManageMenu({
  onAssign,
  onMerge,
  onClose,
  canClose,
}: {
  onAssign: () => void;
  onMerge: () => void;
  onClose: () => void;
  canClose: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full border border-[var(--line)] p-1.5 text-[var(--text-4)] transition-colors hover:bg-[var(--sand)] hover:text-[var(--ink)]"
        aria-label="Manage thread"
        aria-expanded={open}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--paper)] py-1 shadow-lg">
            {[
              { label: 'Assign a call…', run: onAssign, show: true },
              { label: 'Merge thread into this…', run: onMerge, show: true },
              { label: 'Close thread', run: onClose, show: canClose },
            ]
              .filter((i) => i.show)
              .map((i) => (
                <button
                  key={i.label}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    i.run();
                  }}
                  className="block w-full px-3 py-2 text-left text-xs text-[var(--text-2)] transition-colors hover:bg-[var(--sand)]"
                >
                  {i.label}
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Rolling summary ──────────────────────────────────────────────────

function SummaryCard({ thread }: { thread: ThreadDetail }) {
  const lines = (thread.rolling_summary ?? '').split('\n').filter((l) => l.trim());
  if (!lines.length) {
    return (
      <section className="rounded-[14px] border border-[var(--line)] bg-[var(--paper)] p-5">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Summary</h2>
        <p className="mt-2 text-xs text-[var(--text-5)]">
          The summary is written after the first call in this thread completes.
        </p>
      </section>
    );
  }
  const last = lines.length - 1;
  return (
    <section className="rounded-[14px] border border-[var(--line)] bg-[var(--paper)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Summary</h2>
        {thread.summary_updated_after_call != null && (
          <span className="text-[11px] text-[var(--text-5)]">
            updated after call {thread.summary_updated_after_call}
          </span>
        )}
      </div>
      {/* Plain text, deliberately: the backend emits prose, not markdown. */}
      <div className="mt-2 space-y-1.5">
        {lines.map((line, i) => (
          <p
            key={i}
            className={cn(
              'whitespace-pre-wrap text-[13px] leading-relaxed',
              i === last ? 'font-semibold text-[var(--ink)]' : 'text-[var(--text-2)]',
            )}
          >
            {line}
          </p>
        ))}
      </div>
    </section>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────

function TimelineEntry({
  call,
  index,
  total,
  expanded,
  onToggle,
}: {
  call: ThreadCall;
  index: number;
  total: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Only fetched once the entry is open — a 40-call thread must not pull 40
  // transcripts to render its timeline.
  const { data: detail, isLoading, isError } = useCallDetail(expanded ? call.call_sid : null);
  // A purged call says so without waiting for a fetch that has nothing to
  // return: the entry is a stub by definition, never an error (§3.4).
  const purged = !!call.transcript_purged;
  const meta = attachMeta(call.thread_attach_kind);
  const peer = call.direction === 'inbound' ? call.from_number : call.to_number;

  return (
    <li className="relative pl-9">
      {/* The rail, drawn behind the glyphs, stopping at the last entry. */}
      {index < total - 1 && (
        <span className="absolute left-[11px] top-7 h-[calc(100%-0.5rem)] w-px bg-[var(--line)]" aria-hidden="true" />
      )}
      <span className="absolute left-0 top-0">
        <AttachGlyph kind={call.thread_attach_kind} />
      </span>

      <div className="rounded-[10px] border border-[var(--line-soft)] bg-[var(--paper)]">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-5)]" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-5)]" />
          )}
          <span className="flex items-center gap-1 text-xs text-[var(--text-3)]">
            {call.direction === 'outbound' ? (
              <ArrowUpRight className="h-3.5 w-3.5 text-[var(--text-5)]" />
            ) : (
              <ArrowDownLeft className="h-3.5 w-3.5 text-[var(--text-5)]" />
            )}
            <span className="font-mono">{peer || '—'}</span>
          </span>
          <span className="text-xs text-[var(--text-4)]">{fmtDateTime(call.started_at)}</span>
          <span className="font-mono text-xs text-[var(--text-4)]">{fmtDuration(call.duration_seconds)}</span>
          <OutcomeChip call={call} />
          {/* Same component as the history list — per-call only, and silent
              until the thread endpoint carries a reading (§6). */}
          <SentimentDot sentiment={call.sentiment} />
          <LanguageFlag language={call.language} />
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-5)]" title={meta.title}>
            {meta.label}
          </span>
          {call.task_result && (
            <span className="w-full truncate text-[12px] text-[var(--text-3)]" title={call.task_result}>
              {call.task_result}
            </span>
          )}
        </button>

        {expanded && (
          <div className="border-t border-[var(--line-soft)] px-3 py-3">
            {detail ? (
              <CallDetailBody detail={detail} purged={purged} maxHeightClass="max-h-80" />
            ) : purged ? (
              <PurgedTranscriptNote />
            ) : isLoading ? (
              <p className="flex items-center gap-2 text-xs text-[var(--text-5)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading call…
              </p>
            ) : isError ? (
              <p className="text-xs text-[var(--text-5)]">This call's detail could not be loaded.</p>
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

/** The commitment a follow-up is most likely about: expired first, then due. */
function nextCommitment(thread: ThreadDetail): string | null {
  const open = sortCommitments(thread.commitments ?? []).filter((c) => c.status !== 'done');
  const c = open[0];
  return c ? `${c.what}${c.due_at ? ` (${spokenDate(c.due_at)})` : ''}` : null;
}

export default function ThreadDetailView({ threadId }: { threadId: string }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { i18n } = useTranslation();
  const { data: thread, isLoading, isError, error } = useThread(threadId);
  const patch = usePatchThread();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [followUp, setFollowUp] = useState<'now' | 'appointment' | null>(null);

  const expired = thread ? expiredCount(thread) : 0;
  const transitions = useMemo(() => (thread ? allowedTransitions(thread.status) : []), [thread]);

  const move = (next: ThreadStatus) => {
    if (!thread) return;
    patch.mutate(
      { id: thread.id, status: next },
      {
        // 409s carry the server's explanation; the chip is never forced
        // locally — the refetch behind the mutation decides what it says.
        onError: (err) =>
          toast({ title: 'Status not changed', description: err.message, variant: 'destructive' }),
      },
    );
  };

  if (isLoading) {
    return <div className="p-6 text-sm text-[var(--text-5)]">Loading thread…</div>;
  }

  if (isError || !thread) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
        <ThreadGlyph className="text-2xl" />
        <p className="text-sm text-[var(--ink)]">
          {threadRouteMissing(error)
            ? 'This backend does not group calls into threads yet.'
            : 'This thread does not exist.'}
        </p>
        <p className="max-w-md text-xs text-[var(--text-5)]">
          {threadRouteMissing(error)
            ? 'The link will work once the server exposes /api/voice/threads.'
            : error?.message ?? 'It may have been merged into another thread, or the link is out of date.'}
        </p>
        <Link
          to="/telephony/calls"
          className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--text-3)] hover:bg-[var(--sand)]"
        >
          Back to threads
        </Link>
      </div>
    );
  }

  const canFollowUp = thread.status !== 'closed';

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-[var(--line-soft)] px-6 pt-5 pb-4">
        <button
          type="button"
          onClick={() => navigate('/telephony/calls')}
          className="flex items-center gap-1 text-[11px] text-[var(--text-4)] transition-colors hover:text-[var(--ink)]"
        >
          <ArrowLeft className="h-3 w-3" />
          3days.telephony · threads
        </button>

        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <SubjectField thread={thread} />
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-4)]">
              <ThreadStatusChip status={thread.status} />
              <span className="text-[var(--text-2)]">{thread.contact_name || 'Unknown contact'}</span>
              <span className="font-mono">{thread.contact_number}</span>
              <LanguageFlag language={thread.language} />
              <span>
                {thread.call_count} call{thread.call_count === 1 ? '' : 's'}
              </span>
              <span title={`Created ${fmtDateTime(thread.created_at)}`}>
                started {fmtDateTime(thread.created_at)}
              </span>
              <span>· updated {fmtDateTime(thread.updated_at)}</span>
              {expired > 0 && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  {expired} past due
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {transitions.map((next) => (
              <button
                key={next}
                type="button"
                onClick={() => move(next)}
                disabled={patch.isPending}
                className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--text-3)] transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)] disabled:opacity-50"
              >
                {STATUS_ACTION_LABEL[next]}
              </button>
            ))}
            <ManageMenu
              onAssign={() => setAssignOpen(true)}
              onMerge={() => setMergeOpen(true)}
              onClose={() => move('closed')}
              canClose={transitions.includes('closed')}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-4">
          <SummaryCard thread={thread} />

          <section className="rounded-[14px] border border-[var(--line)] bg-[var(--paper)] p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--ink)]">Commitments</h2>
              <span
                className="text-[11px] text-[var(--text-5)]"
                title="Commitments are extracted from the calls themselves. They are not editable here — the calls are what happened."
              >
                extracted from the calls · not editable
              </span>
            </div>
            <div className="mt-2">
              <CommitmentRows commitments={thread.commitments ?? []} />
            </div>
          </section>

          <section className="rounded-[14px] border border-[var(--line)] bg-[var(--paper)] p-5">
            <h2 className="mb-4 text-sm font-semibold text-[var(--ink)]">
              Calls
              <span className="ml-2 text-[11px] font-normal text-[var(--text-5)]">oldest first</span>
            </h2>
            <ol className="space-y-3">
              {thread.calls.map((c, i) => (
                <TimelineEntry
                  key={c.call_sid}
                  call={c}
                  index={i}
                  total={thread.calls.length}
                  expanded={expanded === c.call_sid}
                  onToggle={() => setExpanded((s) => (s === c.call_sid ? null : c.call_sid))}
                />
              ))}
            </ol>

            {canFollowUp && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--line-soft)] pt-4">
                <span className="text-xs text-[var(--text-4)]">Next step in this thread:</span>
                <button
                  type="button"
                  onClick={() => setFollowUp('now')}
                  className="flex items-center gap-1.5 rounded-full bg-[var(--ink)] px-3 py-1.5 text-xs font-medium text-[var(--on-ink)] transition-opacity hover:opacity-85"
                >
                  <PhoneOutgoing className="h-3.5 w-3.5" />
                  Follow-up call
                </button>
                <button
                  type="button"
                  onClick={() => setFollowUp('appointment')}
                  className="flex items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--text-3)] transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)]"
                >
                  <CalendarPlus className="h-3.5 w-3.5" />
                  Schedule appointment
                </button>
              </div>
            )}
          </section>
        </div>
      </div>

      {followUp && (
        <StartCallModal
          onClose={() => setFollowUp(null)}
          initialMode={followUp}
          initialNumber={thread.contact_number}
          initialName={thread.contact_name ?? ''}
          initialLanguage={thread.language ?? ''}
          // A follow-up is the commonest reason anyone pastes a purpose at
          // all, so write the stub for them — editable, and it counts.
          initialPurpose={followUpPurpose(thread.subject, nextCommitment(thread), i18n.language)}
          thread={{ id: thread.id, subject: thread.subject }}
        />
      )}
      {assignOpen && <AssignCallModal thread={thread} onClose={() => setAssignOpen(false)} />}
      {mergeOpen && <MergeThreadModal thread={thread} onClose={() => setMergeOpen(false)} />}
    </div>
  );
}
