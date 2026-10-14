import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { guardedLocalStorage } from './storageDetector';

import enTranslation from './locales/en/translation.json';
import deTranslation from './locales/de/translation.json';

// European languages — mocked (fall back to English content for now)
const mockedLangs = ['fr', 'es', 'it', 'nl', 'pt', 'pl', 'sv', 'da'];

const resources: Record<string, { translation: typeof enTranslation }> = {
  en: { translation: enTranslation },
  de: { translation: deTranslation },
};
mockedLangs.forEach(code => {
  resources[code] = { translation: enTranslation };
});
// Ukrainian: marketing copy falls back to English; the accounting app ships
// full uk resources in its own namespace (src/pages/accounting/_lib/i18n.ts).
resources['uk'] = { translation: enTranslation };

const languageDetector = new LanguageDetector();
languageDetector.addDetector(guardedLocalStorage);

i18n
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['en', 'de', 'uk', ...mockedLangs],
    detection: {
      // The built-in 'localStorage' detector throws when storage refuses a read.
      order: [guardedLocalStorage.name, 'navigator'],
      caches: [guardedLocalStorage.name],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
