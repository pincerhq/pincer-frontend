/**
 * Telephony's "Assistant" entry only re-mounted the regular Chat page at
 * /telephony/assistant — a duplicate of the sidebar's Chat that read as a
 * no-op from inside Telephony. It is gone from the rail and the More sheet,
 * and old links to it land on /chat.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { useSession } from '@/stores/session';
import { NAV_GROUPS } from '@/pages/telephony/_components/sidebar/telephonyNav';
import { ROUTES, TELEPHONY_STATIC_PATHS } from '@/pages/telephony/_lib/routes';
import MobileTabBar from '@/pages/telephony/_components/sidebar/MobileTabBar';
import App from '@/App';

const allItems = () => NAV_GROUPS.flatMap((g) => g.items.flatMap((i) => [i, ...(i.children ?? [])]));

describe('no telephony Assistant entry', () => {
  beforeEach(() => {
    useSession.getState().setLocale('en');
  });

  it('is not in the telephony nav model', () => {
    expect(allItems().map((i) => i.key)).not.toContain('assistant');
    expect(allItems().map((i) => i.path)).not.toContain('/telephony/assistant');
  });

  it('is not a telephony route any more', () => {
    expect(Object.keys(ROUTES)).not.toContain('ASSISTANT');
    expect(TELEPHONY_STATIC_PATHS).not.toContain('/telephony/assistant');
  });

  it('is not in the More sheet', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ThemeProvider>
          <MemoryRouter initialEntries={['/telephony']}>
            <MobileTabBar />
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).queryByRole('button', { name: 'Assistant' })).not.toBeInTheDocument();
  });

  it('sends old /telephony/assistant links to /chat', async () => {
    window.history.pushState({}, '', '/telephony/assistant');
    render(<App />);
    // Signed out, /chat itself goes on to the platform login, keeping /chat as the return target.
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    expect(new URLSearchParams(window.location.search).get('returnTo')).toBe('/chat');
  });
});
