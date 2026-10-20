/**
 * How long a cached presigned link is reused: until its `expires_at`, less a
 * margin of 10% of its life or 30 s, whichever is more.
 */
import { describe, expect, it } from 'vitest';
import { presignStaleMs } from '@/lib/api/storage';

const AT = Date.parse('2026-10-20T12:00:00Z');
const expiring = (seconds: number) => ({ expires_at: new Date(AT + seconds * 1000).toISOString() });

describe('presignStaleMs', () => {
  it('keeps 10% of a long link back', () => {
    expect(presignStaleMs(expiring(900), AT)).toBe(810_000);
    expect(presignStaleMs(expiring(7 * 86400), AT)).toBe(0.9 * 7 * 86400 * 1000);
  });

  it('keeps at least 30 s back from a short link', () => {
    expect(presignStaleMs(expiring(60), AT)).toBe(30_000);
  });

  it('counts from when the link was fetched', () => {
    expect(presignStaleMs(expiring(900), AT + 600_000)).toBe(270_000);
  });

  it('is 0 for a link about to run out, already expired, or without a readable expiry', () => {
    expect(presignStaleMs(expiring(20), AT)).toBe(0);
    expect(presignStaleMs(expiring(-5), AT)).toBe(0);
    expect(presignStaleMs({ expires_at: '' }, AT)).toBe(0);
  });
});
