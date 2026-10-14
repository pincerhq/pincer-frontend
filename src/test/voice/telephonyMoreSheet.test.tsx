/**
 * On a phone the telephony app has no platform sidebar, only its own bottom
 * bar, so its "More" sheet is the one way to reach the theme and the other
 * apps. Both live there: a Light / Dark / System choice wired to the app's
 * theme, and an Apps group linking back to Dashboard, Chat, Tasks, Company
 * and Integrations.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { useSession } from '@/stores/session';
import MobileTabBar from '@/pages/telephony/_components/sidebar/MobileTabBar';

const APPS: Array<[string, string]> = [
  ['Dashboard', '/dashboard'],
  ['Chat', '/chat'],
  ['Tasks', '/tasks'],
  ['Company', '/company-brain'],
  ['Integrations', '/integrations'],
];

function renderBar() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider>
        <MemoryRouter initialEntries={['/telephony']}>
          <Routes>
            <Route path="/telephony" element={<MobileTabBar />} />
            {APPS.map(([name, path]) => (
              <Route key={path} path={path} element={<p>landed on {name}</p>} />
            ))}
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

async function openMore() {
  await userEvent.click(screen.getByRole('button', { name: 'More' }));
  return screen.getByRole('dialog');
}

describe('telephony More sheet', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    useSession.getState().setLocale('en');
  });

  it('offers Light / Dark / System with the current choice marked', async () => {
    renderBar();
    const sheet = await openMore();
    const theme = within(sheet).getByRole('radiogroup', { name: 'Theme' });
    const options = within(theme).getAllByRole('radio');
    expect(options.map((o) => o.textContent)).toEqual(['Light', 'Dark', 'System']);
    expect(within(theme).getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
  });

  it('Dark switches the page to dark and remembers it', async () => {
    renderBar();
    const sheet = await openMore();
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(within(screen.getByRole('dialog')).getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  });

  it.each(APPS)('the Apps group links to %s', async (name) => {
    renderBar();
    const sheet = await openMore();
    const apps = within(sheet).getByRole('group', { name: 'Apps' });
    await userEvent.click(within(apps).getByRole('button', { name }));
    expect(screen.getByText(`landed on ${name}`)).toBeInTheDocument();
  });

  it('labels the new entries in German too', async () => {
    useSession.getState().setLocale('de');
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: 'Mehr' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('radiogroup', { name: 'Darstellung' })).toBeInTheDocument();
    const apps = within(sheet).getByRole('group', { name: 'Apps' });
    expect(within(apps).getByRole('button', { name: 'Aufgaben' })).toBeInTheDocument();
  });
});
