/**
 * /api/health drives the Chat offline lock (composer, Send, mic, Approve/Deny).
 * One dropped poll — a network blip, a backend restart — must not lock chat for
 * a whole poll cycle, so a failed check is retried once after a short delay.
 * A real outage still shows: two failures in a row are "offline" within seconds.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const get = vi.fn();

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, api: { ...actual.api, get: (...args: unknown[]) => get(...args) } };
});

vi.mock('@/lib/api/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/voice')>();
  return {
    ...actual,
    useVoiceConnected: () => true,
    useVoiceStatus: () => ({ data: { enabled: true, voice_configured: true } }),
  };
});

const { useHealth, HEALTH_RETRY_MS, HEALTH_POLL_MS } = await import('@/lib/capabilities');
const { ApiError } = await import('@/lib/api/client');

/** What the client throws when the request never left the browser (status 0). */
const unreachable = () => new ApiError('Could not reach the Pincer backend', 0);

/** An HTTP error as the client throws it; `body` is the JSON body, absent for an HTML page. */
const httpError = (status: number, body?: unknown) =>
  Object.assign(new ApiError(`HTTP ${status}`, status), body === undefined ? {} : { body });

/** Pincer's own error body (FastAPI's shape). */
const PINCER_404 = { detail: 'Not Found' };

// The app's own client sets `retry: 1` globally; a bare client keeps the hook's own options honest.
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('health check retries one failure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    get.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => vi.useRealTimers());

  it('retries a failed check once, shortly after (about 2 s)', () => {
    expect(HEALTH_RETRY_MS).toBeGreaterThanOrEqual(1000);
    expect(HEALTH_RETRY_MS).toBeLessThanOrEqual(3000);
  });

  it('one blip, then an answer: never reports an error', async () => {
    get.mockRejectedValueOnce(unreachable()).mockResolvedValue({ status: 'ok' });
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
    get.mockRejectedValue(unreachable());
    const { result } = renderHook(() => useHealth(), { wrapper });
    await flush();
    expect(result.current.status).not.toBe('error');
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS + 10); });
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('error');
  });
});

describe('health check in a hidden tab', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    get.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => {
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  });

  // The offline countdown promises a check every HEALTH_POLL_MS; a backgrounded
  // tab must keep that promise, or chat sits on "retrying…" with no poll running.
  it('keeps polling while the document is hidden', async () => {
    get.mockResolvedValue({ status: 'ok' });
    renderHook(() => useHealth(), { wrapper });
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
    act(() => focusManager.setFocused(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_POLL_MS + 10); });
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
  });

  // react-query pauses its own retries while the window is unfocused, so the
  // one retry must not depend on focus either — or a hidden tab stalls mid-check.
  it('finishes a failed check (and its retry) while the document is hidden', async () => {
    get.mockResolvedValueOnce({ status: 'ok' });
    const { result } = renderHook(() => useHealth(), { wrapper });
    await flush();
    act(() => focusManager.setFocused(false));
    get.mockRejectedValue(unreachable());
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_POLL_MS + 10); });
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS + 10); });
    await flush();
    expect(get).toHaveBeenCalledTimes(3);
    expect(result.current.status).toBe('error');
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// A check that nobody waits for any more must stop: react-query hands the
// queryFn a signal when the query is cancelled or its last observer leaves.
describe('health check can be cancelled', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    get.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => vi.useRealTimers());

  it('hands both the check and its retry the query signal, so the fetch itself aborts', async () => {
    get.mockRejectedValueOnce(unreachable()).mockResolvedValue({ status: 'ok' });
    renderHook(() => useHealth(), { wrapper });
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS + 10); });
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
    for (const [, init] of get.mock.calls) expect((init as RequestInit | undefined)?.signal).toBeInstanceOf(AbortSignal);
  });

  it('unmounting during the retry delay makes no second request', async () => {
    get.mockRejectedValue(unreachable());
    const { unmount } = renderHook(() => useHealth(), { wrapper });
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS + 10); });
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('cancelling the query during the retry delay makes no second request', async () => {
    get.mockRejectedValue(unreachable());
    renderHook(() => useHealth(), { wrapper });
    await flush();
    await act(async () => { await client.cancelQueries({ queryKey: ['health'] }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS + 10); });
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('a fetch aborted by the signal is not retried', async () => {
    get.mockImplementation((_path: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    renderHook(() => useHealth(), { wrapper });
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => { await client.cancelQueries({ queryKey: ['health'] }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS + 10); });
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
  });
});

// Reachability means "Pincer answered". A 4xx is an answer — retrying cannot
// change it, and chat must not lock over it; a token 401 already ends the
// session in authedFetch. Only "no answer" (status 0) and a 5xx are retried.
describe('which failures are retried', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    get.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => vi.useRealTimers());

  it.each([404, 405, 429])('a %i from Pincer is an answer: connected at once, one request, no retry delay', async (status) => {
    get.mockRejectedValue(httpError(status, { detail: `HTTP ${status}` }));
    const { result } = renderHook(() => useHealth(), { wrapper });
    // Well inside HEALTH_RETRY_MS: the answer lands without the retry delay.
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(result.current.status).toBe('success');
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toEqual({ httpStatus: status });
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS + 10); });
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a 500', () => new ApiError('HTTP 500', 500)],
    ['status 0 (no answer)', unreachable],
  ])('%s gets exactly one retry', async (_name, error) => {
    get.mockRejectedValue(error());
    const { result } = renderHook(() => useHealth(), { wrapper });
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS + 10); });
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('error');
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS + 10); });
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('a 4xx on the retry is an answer too', async () => {
    get.mockRejectedValueOnce(unreachable()).mockRejectedValue(httpError(404, PINCER_404));
    const { result } = renderHook(() => useHealth(), { wrapper });
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS + 10); });
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('success');
  });
});

/** Let `n` polls run, a second per act — so every outcome renders, as on a real clock. */
async function runPolls(n: number) {
  for (let second = 0; second < (n * (HEALTH_POLL_MS + HEALTH_RETRY_MS)) / 1000 + 1; second++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  }
}

// The telephony banner shares ['health']: it says "server unreachable" after
// two failed polls. A server that answers with a 4xx is not unreachable.
describe('telephony status banner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    get.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => vi.useRealTimers());

  it('stays out of "offline" while health answers 404', async () => {
    const { useBannerState } = await import('@/pages/telephony/_components/shared/StatusBanner');
    get.mockRejectedValue(httpError(404, PINCER_404));
    const { result } = renderHook(() => useBannerState(), { wrapper });
    await runPolls(3);
    expect(get.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(result.current.state).toBe('active');
  });

  it('still goes offline after two polls with no answer', async () => {
    const { useBannerState } = await import('@/pages/telephony/_components/shared/StatusBanner');
    get.mockRejectedValue(unreachable());
    const { result } = renderHook(() => useBannerState(), { wrapper });
    await runPolls(3);
    expect(result.current.state).toBe('offline');
  });
});

// Reachable means Pincer answered — and only Pincer answers in JSON with its
// error shape. An HTML page where the API should be (the SPA's index.html
// behind a static fallback, a captive portal) is not Pincer: offline, and not
// retried, since a page like that does not change in 2 s.
describe('only an answer from Pincer counts as reachable', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    get.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    ['an HTML 200 (the client reports it as a missing endpoint)', httpError(404)],
    ['an HTML 404', httpError(404)],
    ['a JSON 4xx that is not Pincer\'s shape (a portal)', httpError(403, { message: 'Log in to the Wi-Fi' })],
    ['a JSON array 4xx', httpError(404, ['nope'])],
  ])('%s: offline, one request', async (_name, error) => {
    get.mockRejectedValue(error);
    const { result } = renderHook(() => useHealth(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS + 10); });
    expect(result.current.status).toBe('error');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('a JSON 404 in Pincer\'s error shape is Pincer answering: connected', async () => {
    get.mockRejectedValue(httpError(404, PINCER_404));
    const { result } = renderHook(() => useHealth(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(result.current.status).toBe('success');
  });

  it('an HTML 502 from a proxy is still retried once, like any 5xx', async () => {
    get.mockRejectedValue(httpError(502));
    renderHook(() => useHealth(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS + 10); });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('the telephony banner goes offline while an HTML page answers', async () => {
    const { useBannerState } = await import('@/pages/telephony/_components/shared/StatusBanner');
    get.mockRejectedValue(httpError(404));
    const { result } = renderHook(() => useBannerState(), { wrapper });
    await runPolls(3);
    expect(result.current.state).toBe('offline');
  });
});

// Pincer serves /api/health without auth (auth_guard PUBLIC_PATHS): it never
// answers it with a 401 or 403, token or not. One there comes from something
// in front of Pincer, and a dead session must never read "connected".
describe('a 401 or 403 on health is never "connected"', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    get.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    ['401, no auth code', httpError(401, { detail: 'Unauthorized' })],
    ['401 token_expired whose refresh was unavailable', httpError(401, { error: 'token_expired', detail: 'Token expired' })],
    ['403', httpError(403, { detail: 'Forbidden' })],
  ])('%s: offline, one request', async (_name, error) => {
    get.mockRejectedValue(error);
    const { result } = renderHook(() => useHealth(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS + 10); });
    expect(result.current.status).toBe('error');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('the telephony banner goes offline while health answers 401', async () => {
    const { useBannerState } = await import('@/pages/telephony/_components/shared/StatusBanner');
    get.mockRejectedValue(httpError(401, { detail: 'Unauthorized' }));
    const { result } = renderHook(() => useBannerState(), { wrapper });
    await runPolls(3);
    expect(result.current.state).toBe('offline');
  });
});
