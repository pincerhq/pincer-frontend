/**
 * At phone width the app sidebar is a sheet. Every page that uses it must
 * offer a labelled button to open it — otherwise navigation and the user menu
 * (Theme, Language, Logout) are out of reach by touch.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useSession } from '@/stores/session';

vi.mock('@/lib/pincerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pincerClient')>();
  return { ...actual, isConnected: () => false, getAuth: () => null };
});

const PAGES: [string, string, () => Promise<{ default: ComponentType }>][] = [
  ['Dashboard', '/dashboard', () => import('@/pages/Dashboard')],
  ['Chat', '/chat', () => import('@/pages/Chat')],
  ['Tasks', '/tasks', () => import('@/pages/Tasks')],
  ['Company', '/company-brain', () => import('@/pages/company/CompanyHome')],
  ['Integrations', '/integrations', () => import('@/pages/IntegrationsPage')],
];

const desktopWidth = window.innerWidth;

beforeAll(() => {
  // Radix drives pointer capture and scrolling; jsdom implements neither.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
  useSession.setState({ locale: 'en', identity: { id: 'alice', displayName: 'Alice', email: null } });
});

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: desktopWidth });
  vi.restoreAllMocks();
});

async function renderPage(path: string, load: () => Promise<{ default: ComponentType }>) {
  const { default: Page } = await load();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Page />
    </MemoryRouter>,
  );
}

describe('mobile sidebar', () => {
  it.each(PAGES)('%s has a labelled button that opens the sidebar sheet', async (_, path, load) => {
    const user = userEvent.setup();
    await renderPage(path, load);

    await user.click(await screen.findByRole('button', { name: 'Open menu' }));

    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /alice/i })).toBeInTheDocument();
  });

  it('the sheet is named and described, so Radix has nothing to warn about', async () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    const user = userEvent.setup();
    await renderPage('/dashboard', PAGES[0][2]);

    // Opened by the shortcut, so this holds whatever opens the sheet.
    await screen.findByText('3days.dashboard');
    await user.keyboard('{Control>}b{/Control}');

    const sheet = await screen.findByRole('dialog', { name: 'Navigation' });
    expect(sheet).toHaveAccessibleDescription(/pages and your account/i);
    const radix = [...errors.mock.calls, ...warnings.mock.calls].map((c) => String(c[0])).filter((m) => /DialogContent|Description/.test(m));
    expect(radix).toEqual([]);
  });
});
