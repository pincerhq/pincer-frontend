/**
 * Dashboard, Tasks, Company, Integrations, Not Found, the auth pages and the
 * shared ui primitives take every colour from the theme tokens.
 *
 * Same rule as chatColorTokens.test.ts: a hardcoded `bg-white` or
 * `rgba(20,22,26,.05)` is right in light mode and stays exactly that in dark
 * mode. Anything that must stay fixed is listed below with its reason, so an
 * exception is a decision rather than an accident.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = path.resolve(__dirname, '../..');

/** Files and folders under src/; folders are walked, so new files are covered too. */
const AREAS = [
  'pages/Dashboard.tsx',
  'components/dashboard',
  'pages/Tasks.tsx',
  'pages/company',
  'pages/IntegrationsPage.tsx',
  'pages/NotFound.tsx',
  'pages/Login.tsx',
  'pages/Signup.tsx',
  'pages/ForgotPassword.tsx',
  'components/ui',
];

const FAMILIES = 'gray|slate|zinc|neutral|stone|blue|indigo|sky|white|black';
const HARDCODED = new RegExp(
  [
    `\\b(?:text|bg|border|ring|ring-offset|from|via|to|fill|stroke|placeholder|divide|outline|shadow|decoration|caret|accent)-(?:${FAMILIES})(?:-\\d{2,3})?(?:\\/[\\d.]+)?\\b`,
    '#[0-9a-fA-F]{3,8}\\b',
    // No `\b` in front: inside `shadow-[0_1px_2px_rgba(…)]` the `_` is a word character.
    'rgba?\\(',
  ].join('|'),
  'g',
);

// A modal scrim dims whatever is behind it, so it stays black in both themes: --ink
// turns light in dark mode and a light scrim would brighten the page it should mute.
const SCRIM = 'bg-black/80';

/** Intentional fixed colours: file → exact line fragments allowed to keep them. */
const EXCEPTIONS: Record<string, string[]> = {
  'components/ui/alert-dialog.tsx': [SCRIM],
  'components/ui/dialog.tsx': [SCRIM],
  'components/ui/sheet.tsx': [SCRIM],
  // Search relevance bar: a data colour, not chrome (nearest token, --brand-200, is ΔE 17.6
  // away). A mid blue that reads on both the light and the dark track, so it stays fixed.
  'pages/company/_components/BrainSearchView.tsx': ['bg-[#5aacee]'],
};

function sources(entry: string): string[] {
  const full = path.join(SRC, entry);
  if (!statSync(full).isDirectory()) return [entry];
  return readdirSync(full).flatMap((name) => sources(path.join(entry, name)));
}

const FILES = AREAS.flatMap(sources).filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\./.test(f));

function hardcoded(file: string): string[] {
  const allowed = EXCEPTIONS[file] ?? [];
  return readFileSync(path.join(SRC, file), 'utf8')
    .split('\n')
    .flatMap((line, i) => {
      const scrubbed = allowed.reduce((l, frag) => l.split(frag).join(''), line);
      return [...scrubbed.matchAll(HARDCODED)].map((m) => `${file}:${i + 1} ${m[0]}`);
    });
}

describe('dashboard, page and ui colours', () => {
  it('covers every area it claims to', () => {
    for (const area of AREAS) expect(FILES.some((f) => f.startsWith(area)), area).toBe(true);
  });

  it.each(FILES)('%s has no hardcoded neutral/blue/white/black colours', (file) => {
    expect(hardcoded(file)).toEqual([]);
  });

  it('every exception still exists (a stale allow-list hides nothing)', () => {
    for (const [file, frags] of Object.entries(EXCEPTIONS)) {
      const src = readFileSync(path.join(SRC, file), 'utf8');
      for (const frag of frags) expect(src, `${file}: ${frag}`).toContain(frag);
    }
  });

  it('catches rgba inside an arbitrary shadow value', () => {
    expect('shadow-[0_30px_60px_-32px_rgba(10,16,60,0.55)]'.match(HARDCODED)).toEqual(['rgba(']);
  });
});
