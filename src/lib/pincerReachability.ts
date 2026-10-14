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
  health: { status: 'pending' | 'error' | 'success' },
): PincerBadge {
  if (!session) return 'demo';
  if (health.status === 'error') return 'offline';
  if (health.status === 'success') return 'connected';
  return 'checking';
}
