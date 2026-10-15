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

describe('pincerBadgeState while a retry is in flight', () => {
  // react-query resets a query that has never had data to status 'pending' at
  // the start of every fetch — so a retry after a failure looks like a first
  // load. The last outcome (a failure) has to keep it offline.
  it('stays offline when the last outcome was a failure, even though status is pending again', () => {
    expect(pincerBadgeState(true, { status: 'pending', errorUpdatedAt: 1_000, dataUpdatedAt: 0 })).toBe('offline');
  });

  it('is still checking on a true first load (no outcome yet)', () => {
    expect(pincerBadgeState(true, { status: 'pending', errorUpdatedAt: 0, dataUpdatedAt: 0 })).toBe('checking');
  });

  it('goes connected as soon as a success lands after failures', () => {
    expect(pincerBadgeState(true, { status: 'success', errorUpdatedAt: 1_000, dataUpdatedAt: 2_000 })).toBe('connected');
  });
});
