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

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  // The OS preference is read fresh on every render, never cached: a copy kept
  // only while on 'system' goes stale under an explicit choice, and switching
  // back would paint one wrong frame before an effect caught up. The listener
  // just re-renders when the OS changes.
  const [, osChanged] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia(DARK_QUERY);
    mq.addEventListener('change', osChanged);
    return () => mq.removeEventListener('change', osChanged);
  }, [theme]);

  const resolvedTheme: ResolvedTheme = theme === 'system' ? (osPrefersDark() ? 'dark' : 'light') : theme;

  // Layout, not passive: the class has to change in the same frame as the
  // components that read resolvedTheme, before the browser paints. (Client-only
  // app, so no server-render warning to avoid.)
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const setTheme = (t: Theme) => {
    writeStoredTheme(t);
    setThemeState(t);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
