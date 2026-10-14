/**
 * The Theme entry in the sidebar user menu: Light / Dark / System, the
 * current one marked, wired to the theme preference.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/dashboard/AppSidebar';
import { useSession } from '@/stores/session';
import { mockOS } from './osColorScheme';

let os: ReturnType<typeof mockOS> | undefined;

beforeAll(() => {
  // Radix drives pointer capture and scrolling; jsdom implements neither.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  useSession.setState({ locale: 'en', identity: { id: 'alice', displayName: 'Alice', email: null } });
});

afterEach(() => {
  os?.restore();
  os = undefined;
});

function renderSidebar() {
  render(
    <ThemeProvider>
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

/**
 * Open the user menu, then its Theme submenu by keyboard. Opened by pointer,
 * the submenu closes as the pointer leaves its trigger for an option: jsdom has
 * no layout, so Radix's grace area between the two is empty.
 */
async function openThemeMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /alice/i }));
  (await screen.findByRole('menuitem', { name: /theme/i })).focus();
  await user.keyboard('{ArrowRight}');
}

async function choose(user: ReturnType<typeof userEvent.setup>, name: string) {
  (await screen.findByRole('menuitemradio', { name })).focus();
  await user.keyboard('{Enter}');
}

const isDark = () => document.documentElement.classList.contains('dark');

describe('theme switch in the user menu', () => {
  it('choosing Dark applies html.dark and persists it', async () => {
    os = mockOS(false);
    const user = userEvent.setup();
    renderSidebar();

    await openThemeMenu(user);
    await choose(user, 'Dark');

    expect(isDark()).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('choosing System drops the override and follows the OS again', async () => {
    localStorage.setItem('theme', 'dark');
    os = mockOS(false);
    const user = userEvent.setup();
    renderSidebar();
    expect(isDark()).toBe(true);

    await openThemeMenu(user);
    await choose(user, 'System');

    expect(localStorage.getItem('theme')).toBe('system');
    expect(isDark()).toBe(false);
    os.set(true);
    expect(isDark()).toBe(true);
  });

  it('marks the current choice, in the menu and on its trigger', async () => {
    localStorage.setItem('theme', 'light');
    os = mockOS(true);
    const user = userEvent.setup();
    renderSidebar();

    await openThemeMenu(user);
    expect(screen.getByRole('menuitem', { name: /theme/i })).toHaveTextContent('Light');
    const checked = () =>
      screen
        .getAllByRole('menuitemradio')
        .filter((item) => item.getAttribute('aria-checked') === 'true')
        .map((item) => item.textContent);
    expect(checked()).toEqual(['Light']);

    await choose(user, 'Dark');
    await openThemeMenu(user);
    expect(screen.getByRole('menuitem', { name: /theme/i })).toHaveTextContent('Dark');
    expect(checked()).toEqual(['Dark']);
  });

  it('is labelled in German for a German owner', async () => {
    useSession.setState({ locale: 'de' });
    os = mockOS(false);
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('button', { name: /alice/i }));
    (await screen.findByRole('menuitem', { name: /darstellung/i })).focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'Hell',
      'Dunkel',
      'System',
    ]);
  });
});
