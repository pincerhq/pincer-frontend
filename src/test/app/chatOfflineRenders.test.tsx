/**
 * The offline countdown ticks once a second. Only the notice and the badge may
 * re-render for it — not the chat page with its message list, chain timelines
 * and sidebar. The sidebar stands in for "the page": Chat renders it on every
 * render of its own, so its render count is the page's.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const T0 = new Date('2026-10-15T12:00:00Z').getTime();
const DOWN = { status: 'error', data: { status: 'ok' }, isError: true, isSuccess: false, fetchStatus: 'idle', dataUpdatedAt: 0, errorUpdatedAt: T0 };
let sidebarRenders = 0;

vi.mock('@/components/dashboard/AppSidebar', () => ({
  AppSidebar: () => {
    sidebarRenders++;
    return <nav data-testid="sidebar" />;
  },
}));

vi.mock('@/lib/capabilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities')>();
  return { ...actual, useHealth: () => DOWN };
});

vi.mock('@/lib/pincerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pincerClient')>();
  return {
    ...actual,
    isConnected: () => true,
    getAuth: () => ({ apiUrl: 'http://pincer.test', token: 't', refreshToken: 'r', expiresAt: T0 + 3_600_000, userId: 'alice' }),
    fetchLatestConversation: async () => null,
  };
});

vi.mock('@/lib/api/conversations', () => ({
  listConversations: async () => ({ conversations: [], limit: 20, offset: 0 }),
}));

const { default: Chat } = await import('@/pages/Chat');

describe('offline countdown render cost', () => {
  afterEach(() => vi.useRealTimers());

  it('ticks the notice and the badge without re-rendering the chat page', async () => {
    vi.useFakeTimers({ now: T0 + 1_000 });
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Chat />
      </MemoryRouter>,
    );
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/— retrying in 29 s\.$/)).toBeInTheDocument();
    const settled = sidebarRenders;

    // One tick per act, so each second commits on its own, as in a browser.
    for (let i = 0; i < 5; i++) act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText(/— retrying in 24 s\.$/)).toBeInTheDocument();
    expect(screen.getByText('Pincer offline').closest('[title]')?.getAttribute('title')).toMatch(/Retrying in 24 s\.$/);
    expect(sidebarRenders - settled).toBe(0);
  });
});
