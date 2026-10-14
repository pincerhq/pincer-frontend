import type { CustomDetector } from 'i18next-browser-languagedetector';

/**
 * The detector's built-in `localStorage` lookup decides storage works by
 * writing a test key once, then reads without a guard. A storage that accepts
 * the write but refuses the read (or is blocked after that first check) makes
 * i18n init throw while modules load, and the page renders nothing. Same key,
 * same results with working storage; a refusal is simply "nothing stored".
 */
export const guardedLocalStorage: CustomDetector = {
  name: 'guardedLocalStorage',
  lookup({ lookupLocalStorage }) {
    if (!lookupLocalStorage) return undefined;
    try {
      return localStorage.getItem(lookupLocalStorage) || undefined;
    } catch {
      return undefined;
    }
  },
  cacheUserLanguage(lng, { lookupLocalStorage }) {
    if (!lookupLocalStorage) return;
    try {
      localStorage.setItem(lookupLocalStorage, lng);
    } catch {
      /* storage unavailable */
    }
  },
};
