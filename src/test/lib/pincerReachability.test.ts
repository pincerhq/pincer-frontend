/**
 * The Chat badge says whether Pincer can be reached, not whether a session
 * token happens to be stored. A stored token with a stopped backend used to
 * read "Pincer connected" — the bug this mapping exists to prevent.
 */
import { describe, it, expect } from 'vitest';
import { pincerBadgeState } from '@/lib/pincerReachability';

describe('pincerBadgeState', () => {
  it.each([
    // session, health query status → badge
    [false, 'pending', 'demo'],
    [false, 'success', 'demo'],
    [false, 'error', 'demo'],
    [true, 'pending', 'checking'],
    [true, 'success', 'connected'],
    [true, 'error', 'offline'],
  ] as const)('session=%s, health=%s → %s', (session, status, badge) => {
    expect(pincerBadgeState(session, { status })).toBe(badge);
  });
});
