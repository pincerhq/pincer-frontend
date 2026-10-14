/**
 * Whether Pincer can actually be reached, for the Chat header badge.
 *
 * A stored session (`isConnected()`) only means a token is in storage; the
 * backend can be stopped while it sits there. Reachability comes from the
 * `/api/health` poll (`useHealth()`, every 30 s, no retries), so the badge
 * turns offline on the first failed poll and back to connected on the next
 * answer — no reload.
 */
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
