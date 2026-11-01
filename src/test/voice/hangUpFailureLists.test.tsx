/**
 * A rejected hang-up on a live list (#27, PR #28 review): on a 502 pincer
 * still drops the call from /api/voice/active, so the row with its End call
 * button unmounts on the refetch. The error and the retry must stay on screen,
 * because the caller may still be on the line. Real hooks and the real
 * EndCallButton; only the network is faked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { ActiveCall } from '@/lib/api/voice';

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
vi.mock('@/lib/capabilities', () => ({
  useCapabilities: () => ({ caps: {}, isLoading: false, isOff: () => false, isDeclared: () => true }),
  useHealth: () => ({ data: undefined }),
}));
vi.mock('@/pages/telephony/_components/voice/StartCallModal', () => ({ default: () => null }));

const { default: LiveView } = await import('@/pages/telephony/_components/voice/LiveView');
const { default: LiveCallsSection } = await import('@/pages/telephony/_components/owner-calls/LiveCallsSection');

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
  });

let active: ActiveCall[];
let endStatus: number;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  endStatus = 502;
  fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path === '/api/voice/active') return json(200, active);
    if (path.endsWith('/end') && init.method === 'POST') {
      // pincer: the call leaves the active list whatever Twilio answers.
      active = [];
      return endStatus === 204 ? json(204) : json(endStatus, { detail: 'Twilio rejected the hang-up: busy' });
    }
    return json(200, {});
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderWith(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const callFor = (sid: string): ActiveCall => ({
  call_sid: sid,
  direction: 'outbound',
  caller_number: '+4930111111',
  target_number: '+491622549781',
  target_name: 'Tina',
  purpose: 'test',
  engine: 'conversation_relay',
  duration_seconds: 53,
});

async function endFrom(scope: HTMLElement) {
  const user = userEvent.setup();
  await user.click(within(scope).getByRole('button', { name: /end call/i }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /end call/i }));
}

describe.each([
  ['Live view', 'live-view', () => <LiveView />],
  ['calls page live section', 'calls-page', () => <LiveCallsSection />],
])('%s', (_name, key, ui) => {
  it('keeps the error and the retry after a rejected hang-up drops the call from the list', async () => {
    const sid = `CA-502-${key}`;
    active = [callFor(sid)];
    const view = renderWith(ui());
    await screen.findByRole('button', { name: /end call/i });

    await endFrom(view.container);

    const failed = await screen.findByTestId('failed-hang-ups');
    expect(within(failed).getByText('Tina')).toBeInTheDocument();
    expect(within(failed).getByRole('alert').textContent).toMatch(/Twilio rejected the hang-up: busy/);
    expect(within(failed).getByRole('button', { name: /retry end call/i })).toBeEnabled();
    // The row itself is gone: the backend no longer lists the call.
    await waitFor(() => expect(screen.getAllByRole('button', { name: /end call/i })).toHaveLength(1));

    // The retry works from there, and a hang-up that went through clears it.
    endStatus = 204;
    await endFrom(failed);
    await waitFor(() => expect(screen.queryByTestId('failed-hang-ups')).toBeNull());
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith(`/${sid}/end`))).toHaveLength(2);
  });

  it('shows nothing extra when the hang-up went through', async () => {
    endStatus = 204;
    active = [callFor(`CA-204-${key}`)];
    const view = renderWith(ui());
    await screen.findByRole('button', { name: /end call/i });

    await endFrom(view.container);

    await waitFor(() => expect(screen.queryByRole('button', { name: /end call/i })).toBeNull());
    expect(screen.queryByTestId('failed-hang-ups')).toBeNull();
  });
});
