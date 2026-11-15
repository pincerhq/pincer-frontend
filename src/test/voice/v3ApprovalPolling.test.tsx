/**
 * `usePendingApprovals` / `useDecideApproval` against the backend's contract:
 * `GET /api/voice/approvals` lists the open approvals (wire `VoiceApprovalOut`,
 * keyed by `approval_id`), `POST /api/voice/approvals/{id}` takes
 * `{approved: bool}` and answers 404 once the approval is no longer open.
 * There is no approvals event stream, so nothing may ask for one.
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

const { isApprovalClosed, useDecideApproval, usePendingApprovals } = await import('@/lib/api/voice');
const { PincerError } = await import('@/lib/pincerClient');

/** As the backend serves it (`VoiceApprovalOut`). */
const WIRE = {
  approval_id: 'apr_1',
  call_sid: 'CA1',
  tool_name: 'calendar.create_event',
  summary: 'Book Tuesday 14:00',
  summary_spoken_language: 'de',
  args_preview: { duration_minutes: 30 },
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  created_at: new Date().toISOString(),
  final_state: '',
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const requestedUrls = () => fetchMock.mock.calls.map(([url]) => String(url));

describe('usePendingApprovals', () => {
  it('lists open approvals from GET /api/voice/approvals, mapped to the card model', async () => {
    fetchMock.mockResolvedValue(jsonRes([WIRE]));

    const { result } = renderHook(() => usePendingApprovals(), { wrapper });

    await waitFor(() => expect(result.current.approvals).toHaveLength(1));
    expect(result.current.approvals[0]).toEqual({
      id: 'apr_1',
      call_sid: 'CA1',
      tool_name: 'calendar.create_event',
      summary: 'Book Tuesday 14:00',
      args_preview: { duration_minutes: 30 },
      expires_at: WIRE.expires_at,
      state: 'pending',
    });
    expect(requestedUrls()).toEqual(['http://backend.test/api/voice/approvals']);
  });

  it('never asks for an approvals stream or the old /pending path', async () => {
    fetchMock.mockResolvedValue(jsonRes([]));

    const { result } = renderHook(() => usePendingApprovals(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    for (const url of requestedUrls()) {
      expect(url).not.toContain('/stream');
      expect(url).not.toContain('/pending');
    }
  });

  it('drops approvals that are already past their expiry', async () => {
    fetchMock.mockResolvedValue(
      jsonRes([WIRE, { ...WIRE, approval_id: 'apr_old', expires_at: new Date(Date.now() - 1_000).toISOString() }]),
    );

    const { result } = renderHook(() => usePendingApprovals(), { wrapper });

    await waitFor(() => expect(result.current.approvals).toHaveLength(1));
    expect(result.current.approvals[0].id).toBe('apr_1');
  });
});

describe('useDecideApproval', () => {
  it('posts {approved} to /api/voice/approvals/{id} and returns the settled state', async () => {
    fetchMock.mockResolvedValue(jsonRes({ ...WIRE, final_state: 'denied' }));

    const { result } = renderHook(() => useDecideApproval(), { wrapper });
    let out: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({ id: 'apr_1', decision: 'deny' });
    });

    expect(out).toEqual({ id: 'apr_1', state: 'denied' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://backend.test/api/voice/approvals/apr_1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ approved: false });
  });

  it('reports a 404 as "no longer open"', async () => {
    fetchMock.mockResolvedValue(jsonRes({ detail: 'Approval not open' }, 404));

    const { result } = renderHook(() => useDecideApproval(), { wrapper });
    let caught: unknown;
    await act(async () => {
      await result.current.mutateAsync({ id: 'apr_1', decision: 'approve' }).catch((e) => (caught = e));
    });

    expect(caught).toBeInstanceOf(PincerError);
    expect(isApprovalClosed(caught as InstanceType<typeof PincerError>)).toBe(true);
    expect(isApprovalClosed(new PincerError('boom', 500))).toBe(false);
  });
});
