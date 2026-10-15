/**
 * Whether Pincer can actually be reached, for the Chat header badge.
 *
 * A stored session (`isConnected()`) only means a token is in storage; the
 * backend can be stopped while it sits there. Reachability comes from the
 * `/api/health` poll (`useHealth()`, every HEALTH_POLL_MS, hidden tab too).
 * Reachable means Pincer answered: a 4xx is an answer and reads as connected.
 * A poll fails only when the check and its one retry (`checkHealth`, after
 * HEALTH_RETRY_MS) both get no answer or a 5xx, so a single blip never reads
 * as offline; the badge turns offline on the first such failed poll and back
 * to connected on the next answer — no reload.
 *
 * The countdown runs to the next poll's start. A poll whose first try gets no
 * answer or a 5xx is in flight up to about HEALTH_RETRY_MS longer (plus the
 * two requests' own time) before it lands; meanwhile the countdown reads
 * 'retrying'.
 */
import { useEffect, useState } from 'react';
import { HEALTH_POLL_MS } from '@/lib/capabilities';

export type PincerBadge = 'demo' | 'checking' | 'connected' | 'offline';

export function pincerBadgeState(
  session: boolean,
  health: { status: 'pending' | 'error' | 'success'; errorUpdatedAt?: number; dataUpdatedAt?: number },
): PincerBadge {
  if (!session) return 'demo';
  if (health.status === 'error') return 'offline';
  if (health.status === 'success') return 'connected';
  // react-query resets a query that never had data to 'pending' at the start of
  // every fetch, so a retry after a failure looks like a first load. The last
  // outcome decides: a failure with no success since stays offline (and locked)
  // while the retry is in flight. Only a true first load — no outcome yet — is
  // 'checking'.
  const failedAt = health.errorUpdatedAt ?? 0;
  if (failedAt > 0 && failedAt >= (health.dataUpdatedAt ?? 0)) return 'offline';
  return 'checking';
}

/**
 * Whole seconds until the next health poll. react-query restarts its refetch
 * interval on every query update, so the next poll is exactly the last attempt
 * (the later of `errorUpdatedAt` / `dataUpdatedAt`) plus the poll interval.
 * Clamped to [0, interval] so clock skew never shows more.
 */
export function retryCountdown(lastAttemptAt: number, now: number, intervalMs = HEALTH_POLL_MS): number {
  return Math.min(intervalMs / 1000, Math.max(0, Math.ceil((lastAttemptAt + intervalMs - now) / 1000)));
}

/**
 * The offline countdown: seconds to the next real poll, `'retrying'` once it is
 * due or in flight, `null` while not offline. One 1 s interval per attempt,
 * started when the attempt lands, so its ticks share the poll's phase; it is
 * cleared when the countdown is due, when a new attempt moves the deadline,
 * and on unmount.
 */
export function useRetryCountdown(active: boolean, lastAttemptAt: number, fetching: boolean): number | 'retrying' | null {
  const [now, setNow] = useState(() => Date.now());
  const due = fetching || lastAttemptAt <= 0 || now >= lastAttemptAt + HEALTH_POLL_MS;

  useEffect(() => {
    setNow(Date.now());
    if (!active || due) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, due, lastAttemptAt]);

  if (!active) return null;
  return due ? 'retrying' : retryCountdown(lastAttemptAt, now);
}
