/**
 * The Live screen (#27): a failed poll must not leave the last list on screen
 * as if those calls were still running. (Whether an open call has ended is the
 * popup's own business: liveCallModal.test.tsx.)
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

let live: { calls: ActiveCall[] | undefined; isLoading: boolean; unavailable: boolean };

vi.mock('@/lib/api/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/voice')>();
  return {
    ...actual,
    useLiveCalls: () => live,
    useVoiceConnected: () => true,
    useVoiceStatus: () => ({ data: undefined }),
  };
});
vi.mock('@/pages/telephony/_components/voice/LiveCallModal', () => ({
  default: ({ call }: { call: ActiveCall }) => <div data-testid="modal">{call.call_sid}</div>,
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
  live = { calls: [CALL], isLoading: false, unavailable: false };
});

describe('Live view', () => {
  it('says live calls cannot be loaded instead of showing an empty or stale list', () => {
    live = { calls: undefined, isLoading: false, unavailable: true };
    renderView();
    expect(screen.getByRole('status').textContent).toMatch(/cannot be loaded/i);
    expect(screen.queryByText(/no calls in progress/i)).toBeNull();
    expect(screen.queryByText('Tina')).toBeNull();
    expect(screen.queryByText(/\d+ in progress/)).toBeNull();
  });

  it('lists the live calls and opens one', async () => {
    const user = userEvent.setup();
    renderView();
    expect(screen.getByText('1 in progress')).toBeInTheDocument();
    await user.click(screen.getByText('Tina'));
    expect(screen.getByTestId('modal').textContent).toBe('CA-live');
  });
});
