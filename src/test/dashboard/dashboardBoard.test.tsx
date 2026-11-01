/**
 * The board is the composable half of the dashboard. Nothing is on the page
 * until it is picked in the ＋ dialog; what is picked can be dragged into
 * order, and the arrangement is remembered for next time.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api/voice', () => ({
  useVoiceStatus: () => ({
    data: {
      engine: 'conversation_relay',
      language: 'en',
      consent_mode: 'one_party',
      outbound_enabled: true,
      voice_configured: true,
      webhook_base_configured: true,
      active_call_count: 0,
    },
  }),
  useActiveCalls: () => ({ data: [] }),
  useLiveCalls: () => ({ calls: [], isLoading: false, unavailable: false }),
  useCallHistoryAll: () => ({
    calls: [
      {
        call_sid: 'CA1',
        direction: 'inbound',
        status: 'completed',
        from_number: '+491725112541',
        to_number: '',
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration_seconds: 161,
        cost_total_usd: 0.37,
      },
    ],
    isLoading: false,
  }),
  useContacts: () => ({ data: [{ name: 'Anna Weber', phone_number: '+4930111222', notes: '' }] }),
  useMessages: () => ({ data: { messages: [], total: 0, unread: 0 } }),
}));

vi.mock('@/lib/api/dashboard', () => ({
  useAuditStats: () => ({ data: { total_entries: 0, by_action: {}, by_tool: {}, total_cost_usd: 0, failed_actions: 0 } }),
  useSkills: () => ({ data: { skills: [] } }),
}));

vi.mock('@/lib/api/integrations', () => ({
  useIntegrations: () => ({ data: { integrations: [] } }),
}));

const { DashboardBoard } = await import('@/components/dashboard/DashboardBoard');

const STORAGE_KEY = 'pincer.dash.board';
const MIME = 'application/x-3days-dashboard';

/** jsdom has no DataTransfer, and drag events need one. */
function transfer(id: string) {
  return { types: [MIME], getData: (type: string) => (type === MIME ? id : ''), setData: vi.fn(), effectAllowed: '' };
}

const board = () => screen.getAllByRole('button', { name: /^Move / }).map((b) => b.getAttribute('aria-label'));

beforeEach(() => localStorage.clear());

describe('dashboard board', () => {
  it('keeps the choice of dashboards inside the ＋ dialog', async () => {
    const user = userEvent.setup();
    render(<DashboardBoard />);

    // Closed, the page shows only what is on the board.
    expect(screen.getByText('Voice')).toBeInTheDocument();
    expect(screen.queryByText('Phone numbers')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: /^add a dashboard$/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /add Phone numbers/i })).toBeInTheDocument();
    // What is already placed reads as placed, and clicking it takes it off.
    expect(within(dialog).getByRole('button', { name: /remove Voice/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('puts a chosen dashboard on the page and remembers it', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DashboardBoard />);

    await user.click(screen.getByRole('button', { name: /^add a dashboard$/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /add Calls to the dashboard/i }));
    // The rest of the page is inert while the dialog is up, so close it first.
    await user.click(within(dialog).getByRole('button', { name: /^done$/i }));

    expect(board()).toEqual([expect.stringContaining('Move Voice'), expect.stringContaining('Move Calls')]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(['voice', 'calls']);

    // A reload rebuilds the same board.
    unmount();
    render(<DashboardBoard />);
    expect(board()).toHaveLength(2);
  });

  it('drags a placed dashboard in front of another', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['voice', 'messages']));
    render(<DashboardBoard />);

    const handle = screen.getByRole('button', { name: /^Move Text/i });
    const voiceCard = document.querySelector('[data-widget="voice"]')!;

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.dragStart(handle, { dataTransfer: transfer('messages') });
    // Dropped on the left half of the first card: it lands in front of it.
    fireEvent.dragOver(voiceCard, { dataTransfer: transfer('messages'), clientX: 0 });
    fireEvent.drop(voiceCard.parentElement!, { dataTransfer: transfer('messages') });

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(['messages', 'voice']);
  });

  it('reorders with the arrow keys, and removes with the close button', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['voice', 'calls']));
    render(<DashboardBoard />);

    const handle = screen.getByRole('button', { name: /^Move Calls/i });
    handle.focus();
    await user.keyboard('{ArrowLeft}');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(['calls', 'voice']);

    await user.click(screen.getByRole('button', { name: /^Remove Calls/i }));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(['voice']);
  });

  it('shows real numbers in the widgets it renders', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['calls', 'phones']));
    render(<DashboardBoard />);

    const calls = document.querySelector('[data-widget="calls"]') as HTMLElement;
    expect(within(calls).getByText('Calls · 14d')).toBeInTheDocument();
    expect(within(calls).getByText('2m 41s')).toBeInTheDocument();
    expect(within(calls).getByText('$0.37')).toBeInTheDocument();

    const phones = document.querySelector('[data-widget="phones"]') as HTMLElement;
    expect(within(phones).getAllByText('+491725112541').length).toBeGreaterThan(0);
  });
});
