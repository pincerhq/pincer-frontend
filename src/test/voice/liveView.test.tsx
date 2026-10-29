/**
 * The Live screen (#27): a failed poll must not leave the last list on screen
 * as if those calls were still running, and an open call that leaves the
 * active list reads as ended.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ActiveCall } from '@/lib/api/voice';

const CALL: ActiveCall = {
  call_sid: 'CA-live',
  direction: 'outbound',
  caller_number: '+4930111111',
  target_number: '+491622549781',
  target_name: 'Tina',
  purpose: 'test',
  engine: 'conversation_relay',
  duration_seconds: 53,
};

let active: { data: ActiveCall[] | undefined; isLoading: boolean; isError: boolean };

vi.mock('@/lib/api/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/voice')>();
  return {
    ...actual,
    useActiveCalls: () => active,
    useVoiceConnected: () => true,
    useVoiceStatus: () => ({ data: undefined }),
  };
});
vi.mock('@/pages/telephony/_components/voice/LiveCallModal', () => ({
  default: ({ call, ended }: { call: ActiveCall; ended?: boolean }) => (
    <div data-testid="modal">{`${call.call_sid}:${ended ? 'ended' : 'live'}`}</div>
  ),
}));
vi.mock('@/components/voice/listen/ListenIn', () => ({ default: () => null }));
vi.mock('@/components/voice/EndCallButton', () => ({ default: () => null }));
vi.mock('@/pages/telephony/_components/voice/StartCallModal', () => ({ default: () => null }));

const { default: LiveView } = await import('@/pages/telephony/_components/voice/LiveView');

const renderView = () =>
  render(
    <MemoryRouter>
      <LiveView />
    </MemoryRouter>,
  );

beforeEach(() => {
  active = { data: [CALL], isLoading: false, isError: false };
});

describe('Live view', () => {
  it('says the server is unreachable instead of showing the last list as live', () => {
    active = { data: [CALL], isLoading: false, isError: true };
    renderView();
    expect(screen.getByText(/server not reachable/i)).toBeInTheDocument();
    expect(screen.queryByText('Tina')).toBeNull();
    expect(screen.queryByText(/\d+ in progress/)).toBeNull();
  });

  it('marks the open call as ended once it leaves the active list', async () => {
    const user = userEvent.setup();
    const { rerender } = renderView();
    await user.click(screen.getByText('Tina'));
    expect(screen.getByTestId('modal').textContent).toBe('CA-live:live');

    active = { data: [], isLoading: false, isError: false };
    rerender(
      <MemoryRouter>
        <LiveView />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('modal').textContent).toBe('CA-live:ended');
  });

  it('does not call an open call ended just because a poll failed', async () => {
    const user = userEvent.setup();
    const { rerender } = renderView();
    await user.click(screen.getByText('Tina'));

    active = { data: [CALL], isLoading: false, isError: true };
    rerender(
      <MemoryRouter>
        <LiveView />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('modal').textContent).toBe('CA-live:live');
  });
});
