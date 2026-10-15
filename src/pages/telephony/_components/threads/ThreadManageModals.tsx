/**
 * Manual curation (S14 §3.5): the two operations that fix what the linking
 * rules got wrong.
 *
 * Both are destructive in the sense that matters — they move history around —
 * so both say exactly what will happen before they do it, and merge takes two
 * deliberate steps.
 */
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Search, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  useAssignCall,
  useCallHistoryAll,
  useMergeThreads,
  useThreads,
  type CallSummary,
  type Thread,
  type ThreadDetail,
} from '@/lib/api/voice';
import { ThreadGlyph, ThreadStatusChip } from './ThreadBits';

const when = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
};

const peer = (c: CallSummary) => (c.direction === 'inbound' ? c.from_number : c.to_number);

// ── Assign a call ────────────────────────────────────────────────────

export function AssignCallModal({
  thread,
  onClose,
}: {
  thread: ThreadDetail;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { calls, isLoading } = useCallHistoryAll(500);
  const assign = useAssignCall();
  const [q, setQ] = useState('');
  const [confirming, setConfirming] = useState<CallSummary | null>(null);

  const inThread = useMemo(() => new Set(thread.calls.map((c) => c.call_sid)), [thread.calls]);

  const candidates = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return calls
      .filter((c) => !inThread.has(c.call_sid))
      .filter((c) => {
        if (!needle) return true;
        const hay = `${c.from_number} ${c.to_number} ${c.call_sid} ${when(c.started_at)} ${c.thread_subject ?? ''}`;
        return hay.toLowerCase().includes(needle);
      })
      // The contact's own calls first — that is what is usually being fixed.
      .sort((a, b) => {
        const mine = (c: CallSummary) => (peer(c) === thread.contact_number ? 0 : 1);
        return mine(a) - mine(b) || new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
      })
      .slice(0, 60);
  }, [calls, inThread, q, thread.contact_number]);

  const run = (call: CallSummary) => {
    assign.mutate(
      { threadId: thread.id, call_sid: call.call_sid },
      {
        onSuccess: () => {
          toast({ title: 'Call assigned', description: `Moved into “${thread.subject}”.` });
          onClose();
        },
        // The server's own words: "thread closed", "call already assigned" —
        // a friendlier sentence here would hide which rule fired (§6).
        onError: (err) =>
          toast({ title: 'Could not assign the call', description: err.message, variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[76vh] w-[92vw] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <div className="border-b border-[var(--line-soft)] px-5 py-4">
          <DialogTitle className="text-base font-semibold text-[var(--ink)]">Assign a call</DialogTitle>
          <p className="mt-1 text-xs text-[var(--text-4)]">
            Pick the call that belongs to <span className="text-[var(--text-2)]">{thread.subject}</span>.
            It keeps its transcript; only where it is filed changes.
          </p>
        </div>

        <div className="border-b border-[var(--line-soft)] px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-5)]" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by number, date or current thread"
              className="h-9 bg-[var(--paper)] pl-8 text-xs"
              aria-label="Search calls"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {isLoading ? (
            <p className="py-6 text-center text-xs text-[var(--text-5)]">Loading call history…</p>
          ) : !candidates.length ? (
            <p className="py-6 text-center text-xs text-[var(--text-5)]">No other calls to assign.</p>
          ) : (
            <ul className="space-y-1.5">
              {candidates.map((c) => (
                <li key={c.call_sid}>
                  <button
                    type="button"
                    onClick={() => (c.thread_id ? setConfirming(c) : run(c))}
                    disabled={assign.isPending}
                    className="flex w-full items-center gap-3 rounded-[10px] border border-[var(--line-soft)] px-3 py-2 text-left transition-colors hover:border-[var(--ink)] disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-xs text-[var(--ink)]">{peer(c) || '—'}</span>
                      <span className="block truncate text-[11px] text-[var(--text-5)]">
                        {when(c.started_at)} · {c.direction}
                      </span>
                    </span>
                    {c.thread_id && c.thread_subject ? (
                      <span className="flex max-w-[220px] items-center gap-1 truncate rounded-full border border-[var(--line)] bg-[var(--sand)] px-2 py-0.5 text-[10px] text-[var(--text-4)]">
                        <ThreadGlyph />
                        {c.thread_subject}
                      </span>
                    ) : (
                      <span className="rounded-full border border-dashed border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--text-5)]">
                        no thread
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {confirming && (
          <div className="border-t border-[var(--line-soft)] bg-amber-50/60 px-5 py-3">
            <p className="flex items-start gap-2 text-xs text-amber-800">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This call is currently in “{confirming.thread_subject}”. Assigning it here removes it
              from that thread.
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--text-3)] hover:bg-[var(--paper)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const call = confirming;
                  setConfirming(null);
                  run(call);
                }}
                className="rounded-full bg-[var(--brand)] px-3 py-1.5 text-xs font-medium text-[var(--on-brand)] hover:bg-[var(--brand-hover)]"
              >
                Move it here
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Merge threads ────────────────────────────────────────────────────

export function MergeThreadModal({
  thread,
  onClose,
}: {
  thread: ThreadDetail;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const merge = useMergeThreads();
  const { data } = useThreads({ status: ['open', 'resolved'] });
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Thread | null>(null);

  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.threads ?? [])
      .filter((t) => t.id !== thread.id)
      .filter((t) => !needle || `${t.subject} ${t.contact_number} ${t.contact_name ?? ''}`.toLowerCase().includes(needle))
      // Same contact first: that is what a duplicate thread looks like.
      .sort((a, b) => {
        const same = (t: Thread) => (t.contact_number === thread.contact_number ? 0 : 1);
        return same(a) - same(b) || new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      });
  }, [data, q, thread.contact_number, thread.id]);

  const run = () => {
    if (!picked) return;
    merge.mutate(
      { threadId: thread.id, source_thread_id: picked.id },
      {
        onSuccess: () => {
          toast({
            title: 'Threads merged',
            description: `“${picked.subject}” was closed and its calls moved here.`,
          });
          onClose();
        },
        onError: (err) =>
          toast({ title: 'Could not merge', description: err.message, variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[70vh] w-[92vw] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <div className="border-b border-[var(--line-soft)] px-5 py-4">
          <DialogTitle className="text-base font-semibold text-[var(--ink)]">
            Merge a thread into this one
          </DialogTitle>
          <p className="mt-1 text-xs text-[var(--text-4)]">
            The other thread's calls move here and it is closed. This cannot be undone.
          </p>
        </div>

        {picked ? (
          // Step two: what exactly is about to happen, in both directions.
          <div className="flex min-h-0 flex-1 flex-col justify-between">
            <div className="space-y-3 px-5 py-4">
              <div className="rounded-[10px] border border-[var(--line)] px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-5)]">Moves in</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--ink)]">
                  <ThreadGlyph />
                  {picked.subject}
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-4)]">
                  {picked.call_count} call{picked.call_count === 1 ? '' : 's'} · {picked.contact_number} ·
                  will be closed
                </p>
              </div>
              <div className="rounded-[10px] border border-[var(--ink)] px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-5)]">Survives</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--ink)]">
                  <ThreadGlyph />
                  {thread.subject}
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-4)]">
                  {thread.call_count} call{thread.call_count === 1 ? '' : 's'} → {thread.call_count + picked.call_count} after
                  the merge
                </p>
              </div>
              <p className="flex items-start gap-2 rounded-[10px] bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Merging is irreversible. The moved calls appear here as manually assigned.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--line-soft)] px-5 py-3">
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--text-3)] hover:bg-[var(--sand)]"
              >
                Back
              </button>
              <button
                type="button"
                onClick={run}
                disabled={merge.isPending}
                className="rounded-full bg-[var(--brand)] px-4 py-1.5 text-xs font-medium text-[var(--on-brand)] hover:bg-[var(--brand-hover)] disabled:opacity-50"
              >
                {merge.isPending ? 'Merging…' : 'Merge threads'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-[var(--line-soft)] px-5 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-5)]" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search threads"
                  className="h-9 bg-[var(--paper)] pl-8 text-xs"
                  aria-label="Search threads to merge"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              {!options.length ? (
                <p className="py-6 text-center text-xs text-[var(--text-5)]">
                  No other open thread to merge.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {options.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => setPicked(t)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-[10px] border px-3 py-2 text-left transition-colors hover:border-[var(--ink)]',
                          t.contact_number === thread.contact_number
                            ? 'border-[var(--line)] bg-[var(--sand)]'
                            : 'border-[var(--line-soft)]',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-[var(--ink)]">{t.subject}</span>
                          <span className="block truncate font-mono text-[11px] text-[var(--text-5)]">
                            {t.contact_number} · {t.call_count} call{t.call_count === 1 ? '' : 's'}
                          </span>
                        </span>
                        <ThreadStatusChip status={t.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
