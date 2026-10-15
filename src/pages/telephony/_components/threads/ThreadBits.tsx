/**
 * The vocabulary of threads (S14): the chip that says which matter a call
 * belongs to, the status chip and its allowed moves, the attach-kind glyph,
 * and the commitments table.
 *
 * Kept in one file so the timeline, the list, the flat call table and the
 * approval card all say the same thing the same way.
 */
import { Link } from 'react-router-dom';
import { Bot, CircleAlert, PhoneIncoming, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CHIP_TONE_CLASS } from '@/pages/telephony/_lib/voiceMeta';
import { type ThreadCommitment } from '@/lib/api/voice';
import {
  attachMeta,
  relativeDate,
  sortCommitments,
  spokenDate,
  threadHref,
} from '@/pages/telephony/_lib/threadMeta';

/** The one glyph that means "thread" everywhere in the app. */
export function ThreadGlyph({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('leading-none', className)}>
      🧵
    </span>
  );
}

/**
 * "🧵 {subject}", linking to the thread. Renders nothing for a threadless
 * call — an empty chip would be a promise of a page that does not exist.
 */
export function ThreadChip({
  threadId,
  subject,
  className,
  as = 'link',
}: {
  threadId?: string | null;
  subject?: string | null;
  className?: string;
  /** `text` where the chip already sits inside a link or a button. */
  as?: 'link' | 'text';
}) {
  if (!threadId || !subject) return null;
  const body = (
    <>
      <ThreadGlyph />
      <span className="min-w-0 truncate">{subject}</span>
    </>
  );
  const cls = cn(
    'inline-flex max-w-[240px] items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--sand)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-3)]',
    as === 'link' && 'transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)]',
    className,
  );
  if (as === 'text') {
    return (
      <span className={cls} title={subject}>
        {body}
      </span>
    );
  }
  return (
    <Link
      to={threadHref(threadId)}
      className={cls}
      title={`Open thread: ${subject}`}
      onClick={(e) => e.stopPropagation()}
    >
      {body}
    </Link>
  );
}

// ── Status ───────────────────────────────────────────────────────────

/** Blue is not in the shared chip palette; threads are the only user of it. */
const BLUE_CHIP = 'border-[var(--brand-200)] bg-[var(--brand-100)] text-[var(--brand)]';

const STATUS_CLASS: Record<string, string> = {
  open: BLUE_CHIP,
  resolved: CHIP_TONE_CLASS.green,
  closed: CHIP_TONE_CLASS.grey,
};

export function ThreadStatusChip({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize',
        STATUS_CLASS[status] ?? CHIP_TONE_CLASS.grey,
        className,
      )}
    >
      {status}
    </span>
  );
}

// ── Attach kind ──────────────────────────────────────────────────────

export function AttachGlyph({ kind, className }: { kind: string; className?: string }) {
  const meta = attachMeta(kind);
  return (
    <span
      title={meta.title}
      aria-label={meta.label}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--paper)] text-[11px] text-[var(--text-3)]',
        className,
      )}
    >
      {meta.glyph}
    </span>
  );
}

// ── Commitments ──────────────────────────────────────────────────────

const WHO_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  callee: PhoneIncoming,
  agent: Bot,
  user: User,
};

const WHO_LABEL: Record<string, string> = {
  callee: 'Caller',
  agent: 'Agent',
  user: 'You',
};

export function CommitmentRows({ commitments }: { commitments: ThreadCommitment[] }) {
  if (!commitments.length) {
    return (
      <p className="px-1 py-3 text-xs text-[var(--text-5)]">
        Nothing was promised on either side yet.
      </p>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-[10px] uppercase tracking-wide text-[var(--text-5)]">
        <tr>
          <th className="w-24 py-1 font-medium">Who</th>
          <th className="py-1 font-medium">What</th>
          <th className="w-48 py-1 font-medium">Due</th>
          <th className="w-24 py-1 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {sortCommitments(commitments).map((c, i) => {
          const Icon = WHO_ICON[c.who] ?? User;
          const done = c.status === 'done';
          const expired = c.status === 'expired';
          return (
            <tr key={`${c.who}-${c.what}-${i}`} className="border-t border-[var(--line-soft)] align-top">
              <td className="py-2">
                <span className="flex items-center gap-1.5 text-xs text-[var(--text-3)]">
                  <Icon className="h-3.5 w-3.5 text-[var(--text-5)]" />
                  {WHO_LABEL[c.who] ?? c.who ?? '—'}
                </span>
              </td>
              <td className={cn('py-2 text-[13px] text-[var(--ink)]', done && 'line-through opacity-60')}>
                {c.what}
              </td>
              <td className="py-2 text-xs text-[var(--text-3)]">
                {spokenDate(c.due_at)}
                {c.due_at && (
                  <span className="ml-1 text-[var(--text-5)]">· {relativeDate(c.due_at)}</span>
                )}
              </td>
              <td className="py-2">
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize',
                    expired ? CHIP_TONE_CLASS.amber : done ? CHIP_TONE_CLASS.green : BLUE_CHIP,
                  )}
                >
                  {expired && <CircleAlert className="h-3 w-3" />}
                  {c.status}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The ❗ that says "something here is past due". */
export function ExpiredDot({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600', className)}
      title={`${count} commitment${count === 1 ? '' : 's'} past due`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      {count}
    </span>
  );
}
