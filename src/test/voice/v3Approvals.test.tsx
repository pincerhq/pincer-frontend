/**
 * The live approval card (S11 §6.5). The properties a caller pays for when they
 * break: the countdown comes from the server's expiry, a second click does not
 * send a second decision, and a transport error stays on the card.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApprovalCard, msRemaining } from '@/components/voice/ApprovalCard';
import type { VoiceApproval } from '@/lib/api/voice';

const APPROVAL: VoiceApproval = {
  id: 'apr_1',
  call_sid: 'CA0123456789abcdef',
  tool_name: 'calendar.create_event',
  summary: 'Book Tuesday 14:00 with Anna Weber (30 min)',
  args_preview: { start: '2026-08-25T14:00:00+02:00', duration_minutes: 30 },
  expires_at: new Date(Date.now() + 25_000).toISOString(),
  state: 'pending',
};

function renderCard(overrides: Partial<Parameters<typeof ApprovalCard>[0]> = {}) {
  const onDecide = vi.fn();
  render(
    <ApprovalCard
      approval={APPROVAL}
      state="pending"
      deciding={null}
      error={null}
      muted
      onToggleMute={() => {}}
      onDecide={onDecide}
      {...overrides}
    />,
  );
  return { onDecide };
}

describe('approval countdown', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('counts down from the server expiry, not from when the card appeared', () => {
    // The approval was created 20s ago with a 25s window; only 5s are left.
    const late = { ...APPROVAL, expires_at: new Date(Date.now() + 5_000).toISOString() };
    render(
      <ApprovalCard
        approval={late}
        state="pending"
        deciding={null}
        error={null}
        muted
        onToggleMute={() => {}}
        onDecide={() => {}}
      />,
    );
    expect(screen.getByTestId('voice-approval-countdown').textContent).toBe('5');
  });

  it('ticks down as the server deadline approaches', async () => {
    renderCard();
    expect(screen.getByTestId('voice-approval-countdown').textContent).toBe('25');
    await vi.advanceTimersByTimeAsync(3_000);
    await waitFor(() =>
      expect(Number(screen.getByTestId('voice-approval-countdown').textContent)).toBeLessThanOrEqual(22),
    );
  });

  it('msRemaining never goes negative and survives a malformed date', () => {
    expect(msRemaining(new Date(Date.now() - 10_000).toISOString())).toBe(0);
    expect(msRemaining('not-a-date')).toBe(0);
  });
});

describe('approval decisions', () => {
  it('shows the tool summary verbatim and the args preview', () => {
    renderCard();
    expect(screen.getByText(APPROVAL.summary)).toBeInTheDocument();
    expect(screen.getByText('calendar.create_event')).toBeInTheDocument();
    expect(screen.getByText('duration_minutes')).toBeInTheDocument();
    expect(screen.getByText('Caller on hold', { exact: false })).toBeInTheDocument();
  });

  it('is double-click safe: both buttons disable once a decision is in flight', async () => {
    const user = userEvent.setup();
    const { onDecide } = renderCard();
    await user.click(screen.getByTestId('voice-approval-approve'));
    expect(onDecide).toHaveBeenCalledWith('approve');

    // The host flips `deciding` on the first click.
    render(
      <ApprovalCard
        approval={APPROVAL}
        state="pending"
        deciding="approve"
        error={null}
        muted
        onToggleMute={() => {}}
        onDecide={onDecide}
      />,
    );
    const [, approveAgain] = screen.getAllByTestId('voice-approval-approve');
    const [, denyAgain] = screen.getAllByTestId('voice-approval-deny');
    expect(approveAgain).toBeDisabled();
    expect(denyAgain).toBeDisabled();
  });

  it.each([
    ['approved', /Approved/i],
    ['denied', /Denied/i],
    ['expired', /Expired/i],
    ['call_ended', /Call ended/i],
  ] as const)('flips to the %s terminal state', (state, text) => {
    renderCard({ state });
    expect(screen.getByTestId('voice-approval-card')).toHaveAttribute('data-approval-state', state);
    expect(screen.getByText(text)).toBeInTheDocument();
    // A terminal card offers no buttons.
    expect(screen.queryByTestId('voice-approval-approve')).toBeNull();
  });

  it('surfaces a transport error on the card instead of dropping the decision', () => {
    renderCard({ error: 'Could not send the decision' });
    expect(screen.getByText('Could not send the decision')).toBeInTheDocument();
    expect(screen.getByTestId('voice-approval-approve')).toBeEnabled();
  });
});

describe('where the card lives', () => {
  it('is mounted at the app root, outside the route table', () => {
    // An approval has to interrupt wherever the owner is. Inside a <Route> it
    // would only exist on that page and the caller would time out.
    const app = readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
    expect(app).toContain('<VoiceApprovalHost />');
    const afterRoutes = app.slice(app.indexOf('</Routes>'));
    expect(afterRoutes).toContain('<VoiceApprovalHost />');
  });
});
