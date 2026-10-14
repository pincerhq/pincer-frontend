/**
 * History, read as matters instead of calls (S14 §2).
 *
 * One row per thread: what it is about, where it stands, how many calls it
 * took. Threadless legacy calls arrive from the API as single-call threads and
 * render identically — the owner should not have to know when the backend
 * learned to group things.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useThreads, type Thread, type ThreadStatus } from '@/lib/api/voice';
import { ExpiredDot, ThreadGlyph, ThreadStatusChip } from './ThreadBits';
import { expiredCount, threadHref, threadsUnavailable } from '@/pages/telephony/_lib/threadMeta';

/** The default view is work in flight; closed threads are opt-in. */
const DEFAULT_STATUS: ThreadStatus[] = ['open', 'resolved'];

const STATUS_FILTERS: { id: string; label: string; status: ThreadStatus[] }[] = [
  { id: 'active', label: 'Open + resolved', status: DEFAULT_STATUS },
  { id: 'open', label: 'Open', status: ['open'] },
  { id: 'resolved', label: 'Resolved', status: ['resolved'] },
  { id: 'closed', label: 'Closed', status: ['closed'] },
  { id: 'all', label: 'All', status: ['open', 'resolved', 'closed'] },
];

function fmtRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

function ThreadRow({ thread, onOpen }: { thread: Thread; onOpen: () => void }) {
  const expired = expiredCount(thread);
  return (
    <tr
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer border-t border-[var(--line-soft)] text-[var(--text-2)] outline-none hover:bg-[color:color-mix(in_srgb,var(--ink)_2%,transparent)] focus-visible:bg-[color:color-mix(in_srgb,var(--ink)_4%,transparent)] [&>td]:px-2"
    >
      <td className="max-w-[380px] py-2.5">
        <div className="flex items-center gap-1.5">
          <ThreadGlyph className="shrink-0 text-[11px]" />
          <span className="truncate text-[13px] font-medium text-[var(--ink)]">{thread.subject}</span>
          <ExpiredDot count={expired} className="shrink-0" />
        </div>
        {thread.state_line && (
          <p className="mt-0.5 truncate text-[11px] text-[var(--text-4)]" title={thread.state_line}>
            {thread.state_line}
          </p>
        )}
      </td>
      <td className="max-w-[180px]">
        <span className="block truncate text-[13px] text-[var(--ink)]">
          {thread.contact_name || '—'}
        </span>
        <span className="block truncate font-mono text-xs text-[var(--text-4)]">
          {thread.contact_number || '—'}
        </span>
      </td>
      <td>
        <ThreadStatusChip status={thread.status} />
      </td>
      <td className="text-right font-mono text-xs tabular-nums">
        {thread.call_count} call{thread.call_count === 1 ? '' : 's'}
      </td>
      <td className="whitespace-nowrap text-right text-xs text-[var(--text-4)]">
        {fmtRelative(thread.updated_at)}
      </td>
    </tr>
  );
}

export default function ThreadsView({ onShowAllCalls }: { onShowAllCalls?: () => void }) {
  const navigate = useNavigate();
  const [filterId, setFilterId] = useState('active');
  const [q, setQ] = useState('');
  const [expiredOnly, setExpiredOnly] = useState(false);

  const status = useMemo(
    () => STATUS_FILTERS.find((f) => f.id === filterId)?.status ?? DEFAULT_STATUS,
    [filterId],
  );
  const { data, isLoading, isError, error, isFetching, refetch } = useThreads({
    status,
    q,
    expiredOnly,
  });

  // Sorted newest-activity first (§2). The server may already do it; a list
  // that re-sorts itself on the client cannot disagree with its own header.
  const threads = useMemo(
    () =>
      [...(data?.threads ?? [])].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      ),
    [data],
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-5)]" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search subject or contact"
            className="h-8 w-56 bg-[var(--paper)] pl-8 text-xs"
            aria-label="Search threads"
          />
        </div>

        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilterId(f.id)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                filterId === f.id
                  ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--on-ink)]'
                  : 'border-[var(--line)] text-[var(--text-3)] hover:bg-[var(--sand)]',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <label className="flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-3)]">
          <input
            type="checkbox"
            checked={expiredOnly}
            onChange={(e) => setExpiredOnly(e.target.checked)}
            className="h-3 w-3 accent-amber-500"
          />
          Has expired commitments
        </label>

        <button
          type="button"
          onClick={() => void refetch()}
          className="ml-auto rounded-full border border-[var(--line)] p-1.5 text-[var(--text-4)] transition-colors hover:bg-[var(--sand)] hover:text-[var(--ink)]"
          aria-label="Refresh threads"
          title="Refresh"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
        </button>
      </div>

      {isError && threadsUnavailable(error) ? (
        // The server has no threads endpoint yet — absence, not an error.
        <div className="mt-6 flex flex-col items-center gap-2 py-10 text-center">
          <ThreadGlyph className="text-lg" />
          <p className="text-sm text-[var(--text-3)]">This backend does not group calls into threads yet.</p>
          <p className="max-w-md text-xs text-[var(--text-5)]">
            Threads appear here as soon as the server exposes <code>/api/voice/threads</code>. Until
            then the full call history is one toggle away.
          </p>
          {onShowAllCalls && (
            <button
              type="button"
              onClick={onShowAllCalls}
              className="mt-1 rounded-full border border-[var(--line)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-3)] transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)]"
            >
              Show all calls
            </button>
          )}
        </div>
      ) : isError ? (
        <p className="mt-4 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
          {error?.message ?? 'Threads could not be loaded.'}
        </p>
      ) : isLoading ? (
        <p className="mt-6 text-center text-xs text-[var(--text-5)]">Loading threads…</p>
      ) : !threads.length ? (
        <div className="mt-6 flex flex-col items-center gap-2 py-10 text-center">
          <ThreadGlyph className="text-lg" />
          <p className="text-sm text-[var(--text-3)]">No threads yet.</p>
          <p className="max-w-md text-xs text-[var(--text-5)]">
            A thread is one matter — every call about it, the rolling summary and what each side
            promised, in one place. Threads appear as soon as the agent places or answers a call.
          </p>
        </div>
      ) : (
        <div className="plat-scroll-x -mx-1 mt-3">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-[var(--text-5)] [&_th]:bg-[var(--sand)] [&_th]:px-2 [&_th]:py-2 [&_th:first-child]:rounded-l-[8px] [&_th:last-child]:rounded-r-[8px]">
              <tr>
                <th className="font-medium">Subject</th>
                <th className="font-medium">Contact</th>
                <th className="font-medium">Status</th>
                <th className="text-right font-medium">Calls</th>
                <th className="text-right font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {threads.map((t) => (
                <ThreadRow key={t.id} thread={t} onOpen={() => navigate(threadHref(t.id))} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
