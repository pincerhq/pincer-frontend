/**
 * Dictation's pure parts: which recognition language a UI language maps to,
 * and how spoken text joins what was already typed.
 */
import { describe, it, expect } from 'vitest';
import { dictatedText, speechLang } from '@/lib/dictation';

describe('speechLang', () => {
  it.each([
    ['en', 'en-US'],
    ['en-GB', 'en-US'],
    ['de', 'de-DE'],
    ['de-AT', 'de-DE'],
    ['uk', 'uk-UA'],
    ['fr', 'fr'],
    [undefined, 'en-US'],
  ])('%s → %s', (ui, lang) => {
    expect(speechLang(ui)).toBe(lang);
  });
});

describe('dictatedText', () => {
  it.each([
    ['', 'hello there', 'hello there'],
    ['Draft', 'a reply', 'Draft a reply'],
    ['Draft ', 'a reply', 'Draft a reply'],
    ['Line one\n', 'line two', 'Line one\nline two'],
    ['Draft', '', 'Draft'],
    ['Draft', '  a reply', 'Draft a reply'],
  ])('%j + %j → %j', (typed, spoken, out) => {
    expect(dictatedText(typed, spoken)).toBe(out);
  });
});
