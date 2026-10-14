/**
 * The theme preference: what the user chose ('light' | 'dark' | 'system'),
 * what is actually applied, and the two things the rest of the app reads off
 * the document root — the `dark` class and `color-scheme`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { Toaster, toast } from '@/components/ui/sonner';
import { mockOS } from './osColorScheme';

function Probe() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button onClick={() => setTheme('dark')}>dark</button>
      <button onClick={() => setTheme('light')}>light</button>
      <button onClick={() => setTheme('system')}>system</button>
    </div>
  );
}

const renderTheme = () =>
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );

const root = () => document.documentElement;
const resolved = () => screen.getByTestId('resolved').textContent;

let os: ReturnType<typeof mockOS> | undefined;

beforeEach(() => {
  localStorage.clear();
  root().classList.remove('dark');
  root().style.colorScheme = '';
});

afterEach(() => {
  os?.restore();
  os = undefined;
  vi.restoreAllMocks();
});

describe('theme preference', () => {
  it("defaults to 'system' and follows a dark OS", () => {
    os = mockOS(true);
    renderTheme();

    expect(screen.getByTestId('theme').textContent).toBe('system');
    expect(resolved()).toBe('dark');
    expect(root().classList.contains('dark')).toBe(true);
    expect(root().style.colorScheme).toBe('dark');
  });

  it('mounting over a dark page never takes dark off, not even for a frame', () => {
    os = mockOS(true);
    root().classList.add('dark'); // what the index.html bootstrap left behind
    const seen = new MutationObserver(() => {});
    seen.observe(root(), { attributes: true, attributeFilter: ['class'], attributeOldValue: true });

    renderTheme();

    const states = [...seen.takeRecords().map((r) => r.oldValue ?? ''), root().className];
    seen.disconnect();
    expect(states.filter((c) => !c.split(' ').includes('dark'))).toEqual([]);
  });

  it('a stored choice wins over the OS', () => {
    localStorage.setItem('theme', 'light');
    os = mockOS(true);
    renderTheme();

    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(resolved()).toBe('light');
    expect(root().classList.contains('dark')).toBe(false);
    expect(root().style.colorScheme).toBe('light');
  });

  it("a storage that throws on read does not crash and behaves as 'system'", () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    os = mockOS(true);
    renderTheme();

    expect(screen.getByTestId('theme').textContent).toBe('system');
    expect(resolved()).toBe('dark');
  });

  it('a storage that throws on write does not crash and still applies the choice', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    os = mockOS(false);
    renderTheme();

    await userEvent.click(screen.getByRole('button', { name: 'dark' }));

    expect(resolved()).toBe('dark');
    expect(root().classList.contains('dark')).toBe(true);
  });

  it("an unrecognised stored value is treated as 'system'", () => {
    localStorage.setItem('theme', 'sepia');
    os = mockOS(true);
    renderTheme();

    expect(screen.getByTestId('theme').textContent).toBe('system');
    expect(resolved()).toBe('dark');
  });

  it("follows the OS live under 'system'", () => {
    os = mockOS(false);
    renderTheme();
    expect(resolved()).toBe('light');

    os.set(true);
    expect(resolved()).toBe('dark');
    expect(root().classList.contains('dark')).toBe(true);
    expect(root().style.colorScheme).toBe('dark');

    os.set(false);
    expect(resolved()).toBe('light');
    expect(root().classList.contains('dark')).toBe(false);
    expect(root().style.colorScheme).toBe('light');
  });

  it('ignores the OS under an explicit choice, and does not even listen to it', () => {
    localStorage.setItem('theme', 'light');
    os = mockOS(false);
    renderTheme();
    expect(os.listening()).toBe(0);

    os.set(true);

    expect(resolved()).toBe('light');
    expect(root().classList.contains('dark')).toBe(false);
  });

  it("returning to 'system' picks up an OS change made meanwhile", async () => {
    localStorage.setItem('theme', 'light');
    os = mockOS(false);
    renderTheme();
    os.set(true);

    await userEvent.click(screen.getByRole('button', { name: 'system' }));

    expect(resolved()).toBe('dark');
    expect(root().classList.contains('dark')).toBe(true);
  });

  it('setTheme persists the choice and toggles html.dark', async () => {
    os = mockOS(false);
    renderTheme();

    await userEvent.click(screen.getByRole('button', { name: 'dark' }));
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(root().classList.contains('dark')).toBe(true);
    expect(root().style.colorScheme).toBe('dark');

    await userEvent.click(screen.getByRole('button', { name: 'light' }));
    expect(localStorage.getItem('theme')).toBe('light');
    expect(root().classList.contains('dark')).toBe(false);
    expect(root().style.colorScheme).toBe('light');
  });
});

/**
 * index.html applies the theme before React exists, so there is no flash on a
 * dark reload. If it ever resolves differently from the provider, the page
 * paints one theme and then switches to the other — the flash it exists to
 * prevent. Run the real script against every case and hold it to the provider.
 */
describe('pre-paint bootstrap in index.html', () => {
  const html = readFileSync(path.resolve(__dirname, '../../../index.html'), 'utf8');
  const bootstrap = html.match(/<script data-theme-bootstrap>([\s\S]*?)<\/script>/)?.[1];

  const applied = () => ({
    dark: root().classList.contains('dark'),
    colorScheme: root().style.colorScheme,
  });

  const reset = () => {
    root().classList.remove('dark');
    root().style.colorScheme = '';
  };

  it('is an inline script in <head>, ahead of the bundle', () => {
    expect(bootstrap).toBeDefined();
    expect(html.indexOf('data-theme-bootstrap')).toBeLessThan(html.indexOf('</head>'));
  });

  const stored = [null, 'light', 'dark', 'system', 'sepia', 'throws'] as const;
  const cases = stored.flatMap((s) => [true, false].map((osDark) => [s, osDark] as const));

  it.each(cases)('resolves like the provider: stored=%s, OS dark=%s', (s, osDark) => {
    if (s === 'throws') {
      vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
    } else if (s !== null) {
      localStorage.setItem('theme', s);
    }
    os = mockOS(osDark);

    new Function(bootstrap ?? '')();
    const fromBootstrap = applied();

    reset();
    renderTheme();
    const fromProvider = applied();
    cleanup();

    expect(fromBootstrap).toEqual(fromProvider);
  });
});

describe('toasts', () => {
  it('follow resolvedTheme, not the OS directly', async () => {
    localStorage.setItem('theme', 'dark');
    os = mockOS(false);
    render(
      <ThemeProvider>
        <Toaster />
      </ThemeProvider>,
    );

    act(() => {
      toast('Saved');
    });

    const toaster = await screen.findByText('Saved');
    expect(toaster.closest('[data-sonner-toaster]')?.getAttribute('data-theme')).toBe('dark');
  });
});
