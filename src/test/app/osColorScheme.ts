/**
 * A `prefers-color-scheme` a test can flip, firing `change` like a browser.
 * Shared by the theme preference and theme switch tests.
 */
import { act } from '@testing-library/react';

const QUERY = '(prefers-color-scheme: dark)';

export function mockOS(initiallyDark: boolean) {
  let dark = initiallyDark;
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query === QUERY && dark;
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => {
      if (query === QUERY) listeners.add(fn);
    },
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => {
      listeners.delete(fn);
    },
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) {
      dark = next;
      act(() => {
        listeners.forEach((fn) => fn({ matches: next, media: QUERY } as MediaQueryListEvent));
      });
    },
    /** How many `change` listeners are attached right now. */
    listening() {
      return listeners.size;
    },
    restore() {
      window.matchMedia = original;
    },
  };
}
