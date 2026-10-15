import { createContext, useContext, useEffect, useLayoutEffect, useReducer, useState } from 'react';

/**
 * Every theme a user can pick; both theme pickers list these. index.html's
 * pre-paint script accepts the same values (it can't import this); the
 * themePreference parity test runs it against each one.
 */
export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const STORAGE_KEY = 'theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

/**
 * Storage can throw (Safari private mode, blocked site data). A preference we
 * cannot read is no preference: behave as 'system'. index.html's bootstrap
 * script resolves the same way before first paint — keep the two in step.
 */
const readStoredTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return THEMES.find((t) => t === stored) ?? 'system';
  } catch {
    return 'system';
  }
};

const writeStoredTheme = (theme: Theme) => {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not persisted; the choice still applies for this page's lifetime.
  }
};

const osPrefersDark = () => window.matchMedia(DARK_QUERY).matches;

const resolve = (theme: Theme): ResolvedTheme => (theme === 'system' ? (osPrefersDark() ? 'dark' : 'light') : theme);

/** Put the theme on the document root: the `dark` class and the native color-scheme. */
const applyToRoot = (resolved: ResolvedTheme) => {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
};

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  // The OS preference is read fresh on every render, never cached: a copy kept
  // only while on 'system' goes stale under an explicit choice, and switching
  // back would paint one wrong frame before an effect caught up. The listener
  // just re-renders when the OS changes.
  const [, osChanged] = useReducer((n: number) => n + 1, 0);

  // Every change reaches <html> BEFORE the re-render it causes: children's
  // layout effects run before this provider's, so a component that measures
  // colours in one (charts, canvas) must already find the new class there.
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      applyToRoot(resolve('system'));
      osChanged();
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const resolvedTheme = resolve(theme);

  // The backstop for anything that did not go through setTheme or the listener
  // (first mount without the index.html bootstrap). Layout, not passive, so it
  // still lands before paint; the app is client-only, so no SSR warning.
  useLayoutEffect(() => applyToRoot(resolvedTheme), [resolvedTheme]);

  const setTheme = (t: Theme) => {
    writeStoredTheme(t);
    applyToRoot(resolve(t));
    setThemeState(t);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
