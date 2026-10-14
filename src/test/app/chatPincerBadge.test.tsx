/**
 * The Chat header badge follows the /api/health poll. A stored session with a
 * backend that does not answer is "Pincer offline", never "Pincer connected" —
 * and while it is offline nothing on the page can start a request: the
 * composer and pending approvals lock until health recovers, and whatever was
 * typed stays put.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { StreamEvent } from '@/lib/pincerClient';

const health = vi.fn();
const streamChat = vi.fn((..._args: unknown[]): AsyncGenerator<StreamEvent> => (async function* () {})());
const respondApproval = vi.fn(async (..._args: unknown[]) => undefined);

const T0 = new Date('2026-10-14T12:00:00Z').getTime();
const OK = { status: 'success', data: { status: 'ok' }, isError: false, isSuccess: true, fetchStatus: 'idle', dataUpdatedAt: T0, errorUpdatedAt: 0 };
const DOWN = { status: 'error', data: { status: 'ok' }, isError: true, isSuccess: false, fetchStatus: 'idle', dataUpdatedAt: 0, errorUpdatedAt: T0 };
const CHECKING = { status: 'pending', data: undefined, isError: false, isSuccess: false, fetchStatus: 'fetching', dataUpdatedAt: 0, errorUpdatedAt: 0 };

vi.mock('@/lib/capabilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities')>();
  return { ...actual, useHealth: () => health() };
});

vi.mock('@/lib/pincerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pincerClient')>();
  return {
    ...actual,
    isConnected: () => true,
    getAuth: () => ({ apiUrl: 'http://pincer.test', token: 't', refreshToken: 'r', expiresAt: Date.now() + 60_000, userId: 'alice' }),
    fetchLatestConversation: async () => null,
    streamChat: (...args: unknown[]) => streamChat(...args),
    respondApproval: (...args: unknown[]) => respondApproval(...args),
  };
});

vi.mock('@/lib/api/conversations', () => ({
  listConversations: async () => ({ conversations: [], limit: 20, offset: 0 }),
}));

const { default: Chat } = await import('@/pages/Chat');

// A fresh element each time: re-rendering the identical element object lets
// React bail out, and the new health state would never be read.
const ui = () => (
  <MemoryRouter initialEntries={['/chat']}>
    <Chat />
  </MemoryRouter>
);

function renderChat() {
  return render(ui());
}

const OFFLINE_NOTICE = /^Pincer is offline\. Chat is unavailable until it reconnects — retrying/;
const composer = () => screen.getByRole('textbox');
const control = (name: string) => screen.getByRole('button', { name });

describe('chat Pincer badge', () => {
  beforeEach(() => health.mockReset());

  it('says offline when the health poll fails, even with a stored session', () => {
    health.mockReturnValue(DOWN);
    renderChat();
    expect(screen.getByText('Pincer offline')).toBeInTheDocument();
    expect(screen.queryByText('Pincer connected')).not.toBeInTheDocument();
  });

  it('says connected only once the health poll has answered', () => {
    health.mockReturnValue(OK);
    renderChat();
    expect(screen.getByText('Pincer connected')).toBeInTheDocument();
  });

  it('says checking before the first health answer', () => {
    health.mockReturnValue(CHECKING);
    renderChat();
    expect(screen.getByText('Checking Pincer…')).toBeInTheDocument();
    expect(screen.queryByText('Pincer connected')).not.toBeInTheDocument();
  });
});

describe('chat while Pincer is offline', () => {
  beforeEach(() => {
    health.mockReset();
    streamChat.mockReset();
    respondApproval.mockClear();
  });

  it('locks every control that would start a request and says why', () => {
    health.mockReturnValue(DOWN);
    renderChat();
    expect(screen.getByText(OFFLINE_NOTICE)).toBeInTheDocument();
    expect(composer()).toBeDisabled();
    for (const name of ['Send message', 'Attach file', 'Voice input', 'Mention an agent']) {
      expect(control(name)).toBeDisabled();
    }
  });

  it('keeps the composer usable while the first health check is still pending', () => {
    health.mockReturnValue(CHECKING);
    renderChat();
    expect(screen.queryByText(OFFLINE_NOTICE)).not.toBeInTheDocument();
    expect(composer()).toBeEnabled();
    expect(control('Attach file')).toBeEnabled();
  });

  it('keeps typed text unsent while offline and unlocks by itself on recovery', async () => {
    const user = userEvent.setup();
    health.mockReturnValue(OK);
    const view = renderChat();
    await user.type(composer(), 'Draft the weekly report');

    health.mockReturnValue(DOWN);
    view.rerender(ui());
    expect(composer()).toBeDisabled();
    expect(composer()).toHaveValue('Draft the weekly report');
    expect(control('Send message')).toBeDisabled();

    health.mockReturnValue(OK);
    view.rerender(ui());
    expect(screen.queryByText(OFFLINE_NOTICE)).not.toBeInTheDocument();
    expect(composer()).toBeEnabled();
    expect(composer()).toHaveValue('Draft the weekly report');
    expect(control('Send message')).toBeEnabled();
    expect(streamChat).not.toHaveBeenCalled();
  });

  it('a pending approval cannot be decided while offline', async () => {
    const user = userEvent.setup();
    health.mockReturnValue(OK);
    streamChat.mockImplementation(async function* () {
      yield { event: 'approval', data: { approval_id: 'ap-1', tool: 'send_email' } } as StreamEvent;
      yield { event: 'chunk', data: { delta: 'Waiting for your approval.' } } as StreamEvent;
      yield { event: 'done', data: {} } as StreamEvent;
    });
    const view = renderChat();
    await user.type(composer(), 'Email the team{Enter}');
    await screen.findByText('Approval required');

    health.mockReturnValue(DOWN);
    view.rerender(ui());
    expect(control('Approve')).toBeDisabled();
    expect(control('Deny')).toBeDisabled();
    await act(async () => {
      control('Approve').click();
    });
    expect(respondApproval).not.toHaveBeenCalled();

    health.mockReturnValue(OK);
    view.rerender(ui());
    expect(control('Approve')).toBeEnabled();
  });
});

describe('offline countdown', () => {
  beforeEach(() => health.mockReset());
  afterEach(() => vi.useRealTimers());

  const badgeTitle = () => screen.getByText('Pincer offline').closest('[title]')?.getAttribute('title');

  it('counts down to the next health poll in the notice and the badge title', () => {
    vi.useFakeTimers({ now: T0 + 1_000 });
    health.mockReturnValue(DOWN);
    renderChat();
    expect(screen.getByText(/— retrying in 29 s\.$/)).toBeInTheDocument();
    expect(badgeTitle()).toMatch(/Retrying in 29 s\.$/);

    act(() => vi.advanceTimersByTime(14_000));
    expect(screen.getByText(/— retrying in 15 s\.$/)).toBeInTheDocument();
    expect(badgeTitle()).toMatch(/Retrying in 15 s\.$/);

    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByText(/— retrying…$/)).toBeInTheDocument();
  });

  it('says retrying while the health request is in flight', () => {
    vi.useFakeTimers({ now: T0 + 5_000 });
    health.mockReturnValue({ ...DOWN, fetchStatus: 'fetching' });
    renderChat();
    expect(screen.getByText(/— retrying…$/)).toBeInTheDocument();
  });
});

describe('a health retry in flight after a failure', () => {
  beforeEach(() => health.mockReset());

  it('keeps chat offline and locked, and says retrying', () => {
    // What react-query reports while re-fetching a query that never had data:
    // status back to 'pending', but the last outcome was a failure.
    health.mockReturnValue({ ...CHECKING, fetchStatus: 'fetching', errorUpdatedAt: T0, dataUpdatedAt: 0 });
    renderChat();
    expect(screen.getByText('Pincer offline')).toBeInTheDocument();
    expect(screen.getByText(/— retrying…$/)).toBeInTheDocument();
    expect(composer()).toBeDisabled();
    expect(control('Send message')).toBeDisabled();
  });

  it('a true first load (no answer, no error yet) is checking and unlocked', () => {
    health.mockReturnValue({ ...CHECKING, fetchStatus: 'fetching', errorUpdatedAt: 0, dataUpdatedAt: 0 });
    renderChat();
    expect(screen.getByText('Checking Pincer…')).toBeInTheDocument();
    expect(composer()).toBeEnabled();
  });
});
