/**
 * Live calls and ending them from the app (#27), against the pincer contract
 * (POST /api/voice/calls/{sid}/end: 204, 404 "Call is not active", 502):
 * a call that had already ended is not an error, a rejected hang-up stays
 * retryable after the call left the list, and a failing poll reads as
 * "unavailable" steadily instead of flickering back to "loading".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
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

const { useEndCall, useHangUpFailure, useLiveCalls } = await import('@/lib/api/voice');

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
        '["voice","threads"]',
        '["voice","thread"]',
      ]),
    );
  });

  it('treats "Call is not active" (it had already ended) as done', async () => {
    fetchMock.mockResolvedValue(res(404, { detail: 'Call is not active' }));
    const { result } = renderHook(() => useEndCall(), { wrapper });

    result.current.mutate('CA1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('does not take any other 404 (a missing route) for a hang-up', async () => {
    fetchMock.mockResolvedValue(res(404, { detail: 'Not Found' }));
    const { result } = renderHook(() => useEndCall(), { wrapper });

    result.current.mutate('CA1');
    await waitFor(() => expect(result.current.isError).toBe(true));
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

  it('remembers a rejected hang-up for the retry, and forgets it once the retry succeeds', async () => {
    fetchMock.mockResolvedValueOnce(res(502, { detail: 'Twilio rejected the hang-up: busy' }));
    const { result } = renderHook(() => ({ end: useEndCall(), failed: useHangUpFailure('CA-retry') }), { wrapper });

    act(() => result.current.end.mutate('CA-retry'));
    await waitFor(() => expect(result.current.failed).toMatch(/Twilio rejected the hang-up: busy/));

    fetchMock.mockResolvedValueOnce(res(204));
    act(() => result.current.end.mutate('CA-retry'));
    await waitFor(() => expect(result.current.failed).toBeNull());
  });
});

describe('useLiveCalls', () => {
  it('reads a failing poll as unavailable, and stays so while the next poll is out', async () => {
    fetchMock.mockResolvedValueOnce(res(500, { detail: 'boom' }));
    const { result } = renderHook(() => useLiveCalls(), { wrapper });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.calls).toBeUndefined();

    // A query with no data goes back to `pending` on a refetch: no flicker to "loading".
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    act(() => void qc.refetchQueries({ queryKey: ['voice', 'active'] }));
    await waitFor(() => expect(qc.getQueryState(['voice', 'active'])?.fetchStatus).toBe('fetching'));
    expect(result.current.unavailable).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('hides the last list after a failed poll, and shows calls again once a poll succeeds', async () => {
    const call = { call_sid: 'CA1', direction: 'inbound', duration_seconds: 5 };
    fetchMock.mockResolvedValueOnce(res(200, [call]));
    const { result } = renderHook(() => useLiveCalls(), { wrapper });
    await waitFor(() => expect(result.current.calls).toHaveLength(1));

    fetchMock.mockResolvedValueOnce(res(500, { detail: 'boom' }));
    await act(() => qc.refetchQueries({ queryKey: ['voice', 'active'] }));
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.calls).toBeUndefined();

    fetchMock.mockResolvedValueOnce(res(200, []));
    await act(() => qc.refetchQueries({ queryKey: ['voice', 'active'] }));
    await waitFor(() => expect(result.current.unavailable).toBe(false));
    expect(result.current.calls).toEqual([]);
  });
});
