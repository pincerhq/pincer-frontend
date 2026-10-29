/**
 * Ending a call from the app (#27): a call that had already ended is not an
 * error, and the live views refresh even when the hang-up fails, because the
 * backend drops the call either way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/pincerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pincerClient')>();
  return {
    ...actual,
    isConnected: () => true,
    getAuth: () => ({ apiUrl: 'http://backend.test', token: 't', userId: 'u' }),
    authHeaders: () => ({ Authorization: 'Bearer t' }),
    authedFetch: (path: string, init: RequestInit = {}) =>
      fetch(`http://backend.test${path}`, {
        ...init,
        headers: { Authorization: 'Bearer t', ...(init.headers as Record<string, string> | undefined) },
      }),
  };
});

const { useEndCall } = await import('@/lib/api/voice');

let qc: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const res = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
  });

const invalidated = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map(([filters]) => JSON.stringify((filters as { queryKey: unknown }).queryKey));

describe('useEndCall', () => {
  it('posts to the end endpoint and refreshes every view of the call', async () => {
    fetchMock.mockResolvedValue(res(204));
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useEndCall(), { wrapper });

    result.current.mutate('CA 1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://backend.test/api/voice/calls/CA%201/end');
    expect((init as RequestInit).method).toBe('POST');
    expect(invalidated(spy)).toEqual(
      expect.arrayContaining([
        '["voice","active"]',
        '["voice","calls"]',
        '["voice","status"]',
        '["voice","call","CA 1"]',
        '["voice","call-live","CA 1"]',
      ]),
    );
  });

  it('treats a 404 (the call had already ended) as done', async () => {
    fetchMock.mockResolvedValue(res(404, { detail: 'Call not active' }));
    const { result } = renderHook(() => useEndCall(), { wrapper });

    result.current.mutate('CA1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('surfaces a failed hang-up and still refreshes the live list', async () => {
    fetchMock.mockResolvedValue(res(502, { detail: 'Twilio rejected the hang-up' }));
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useEndCall(), { wrapper });

    result.current.mutate('CA1');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/Twilio rejected/);
    expect(invalidated(spy)).toContain('["voice","active"]');
  });
});
