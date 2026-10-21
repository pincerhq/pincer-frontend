/**
 * How long a cached presigned link is reused: its life less a margin of 10%
 * or 30 s, whichever is more. Its life comes from the server's presign_ttl, so
 * a client clock that is off does not move the window; `expires_at` is only
 * the fallback.
 */
import { describe, expect, it } from 'vitest';
import { presignLifeMs, presignStaleMs } from '@/lib/api/storage';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const expiring = (seconds: number) => ({ expires_at: new Date(NOW + seconds * 1000).toISOString() });

describe('presignStaleMs', () => {
  it('keeps 10% of a long link back', () => {
    expect(presignStaleMs(900_000)).toBe(810_000);
    expect(presignStaleMs(7 * 86400_000)).toBe(0.9 * 7 * 86400_000);
  });

  it('keeps at least 30 s back from a short link', () => {
    expect(presignStaleMs(60_000)).toBe(30_000);
  });

  it('is 0 for a link about to run out, or with no life', () => {
    expect(presignStaleMs(20_000)).toBe(0);
    expect(presignStaleMs(0)).toBe(0);
  });
});

describe('presignLifeMs', () => {
  it('takes the TTL, whatever expires_at says against a skewed client clock', () => {
    // The client is 5 minutes behind the server: expires_at looks 300 s further away than it is.
    expect(presignLifeMs(expiring(1200), 900, NOW)).toBe(900_000);
  });

  it('falls back to expires_at without a TTL', () => {
    expect(presignLifeMs(expiring(900), undefined, NOW)).toBe(900_000);
    expect(presignLifeMs(expiring(-5), undefined, NOW)).toBe(0);
    expect(presignLifeMs({ expires_at: '' }, undefined, NOW)).toBe(0);
  });
});
