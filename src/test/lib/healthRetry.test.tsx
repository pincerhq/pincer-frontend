/**
 * /api/health drives the Chat offline lock (composer, Send, mic, Approve/Deny).
 * One dropped poll — a network blip, a backend restart — must not lock chat for
 * a whole poll cycle, so a failed check is retried once after a short delay.
 * A real outage still shows: two failures in a row are "offline" within seconds.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const get = vi.fn();

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, api: { ...actual.api, get: (...args: unknown[]) => get(...args) } };
});

vi.mock('@/lib/api/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/voice')>();
  return { ...actual, useVoiceConnected: () => true };
});

const { useHealth, HEALTH_RETRY_MS } = await import('@/lib/capabilities');

function wrapper({ children }: { children: ReactNode }) {
  // The app's own client sets `retry: 1` globally; a bare client keeps the hook's own options honest.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('health check retries one failure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    get.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('retries a failed check once, shortly after (about 2 s)', () => {
    expect(HEALTH_RETRY_MS).toBeGreaterThanOrEqual(1000);
    expect(HEALTH_RETRY_MS).toBeLessThanOrEqual(3000);
  });

  it('one blip, then an answer: never reports an error', async () => {
    get.mockRejectedValueOnce(new Error('blip')).mockResolvedValue({ status: 'ok' });
    const seen: string[] = [];
    const { result } = renderHook(() => { const h = useHealth(); seen.push(h.status); return h; }, { wrapper });
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS + 10); });
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('success');
    expect(seen).not.toContain('error');
  });

  it('two failures in a row: offline within the retry delay, not after a whole poll', async () => {
    get.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useHealth(), { wrapper });
    await flush();
    expect(result.current.status).not.toBe('error');
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS + 10); });
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('error');
  });
});
