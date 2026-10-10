/**
 * `usePendingApprovals`: stream first, poll as a safety net. The case that
 * matters is the unhappy one — kill the connection mid-wait and the approval
 * still has to resolve.
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

const { onApprovalTerminal, usePendingApprovals } = await import('@/lib/api/voice');

const APPROVAL = {
  id: 'apr_1',
  call_sid: 'CA1',
  tool_name: 'calendar.create_event',
  summary: 'Book Tuesday 14:00',
  args_preview: { duration_minutes: 30 },
  expires_at: new Date(Date.now() + 60_000).toISOString(),
};

/** A body that yields the given SSE chunks and stays open. */
function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(encoder.encode(c)));
      // Left open: closing would trigger the reconnect loop.
    },
    cancel() {},
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const jsonRes = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe('usePendingApprovals', () => {
  it('shows an approval pushed over the stream', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/approvals/stream')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          body: sseBody([`event: voice_approval\ndata: ${JSON.stringify(APPROVAL)}\n\n`]),
        } as unknown as Response);
      }
      return Promise.resolve(jsonRes([]));
    });

    const { result } = renderHook(() => usePendingApprovals(), { wrapper });

    await waitFor(() => expect(result.current.approvals).toHaveLength(1));
    expect(result.current.approvals[0].id).toBe('apr_1');
    await waitFor(() => expect(result.current.streaming).toBe(true));
  });

  it('still delivers the approval when the stream is dead — the poll covers it', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/approvals/stream')) {
        return Promise.reject(new Error('connection refused'));
      }
      return Promise.resolve(jsonRes([APPROVAL]));
    });

    const { result } = renderHook(() => usePendingApprovals(), { wrapper });

    await waitFor(() => expect(result.current.approvals).toHaveLength(1));
    // …and the UI can tell the difference, so it can say "polling".
    expect(result.current.streaming).toBe(false);
  });

  it('drops the card and reports the terminal state when it is decided elsewhere', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/approvals/stream')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          body: sseBody([
            `event: voice_approval\ndata: ${JSON.stringify(APPROVAL)}\n\n`,
            `event: voice_approval\ndata: ${JSON.stringify({ ...APPROVAL, state: 'approved' })}\n\n`,
          ]),
        } as unknown as Response);
      }
      return Promise.resolve(jsonRes([]));
    });

    const terminal = vi.fn();
    const off = onApprovalTerminal(terminal);
    const { result } = renderHook(() => usePendingApprovals(), { wrapper });

    await waitFor(() => expect(terminal).toHaveBeenCalledWith('apr_1', 'approved'));
    await waitFor(() => expect(result.current.approvals).toHaveLength(0));
    off();
  });

  it('ignores events on the shared stream that are not voice approvals', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/approvals/stream')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          body: sseBody([
            `event: chat_approval\ndata: ${JSON.stringify({ id: 'other' })}\n\n`,
            ': ping\n\n',
          ]),
        } as unknown as Response);
      }
      return Promise.resolve(jsonRes([]));
    });

    const { result } = renderHook(() => usePendingApprovals(), { wrapper });
    await waitFor(() => expect(result.current.streaming).toBe(true));
    expect(result.current.approvals).toHaveLength(0);
  });
});
