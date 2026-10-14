/**
 * Chat and the app sidebar take every colour from the theme tokens.
 *
 * A hardcoded `text-gray-700` or `#14161a` looks right in light mode and stays
 * exactly that colour in dark mode, which is how a page ends up half-themed.
 * Anything that must stay fixed in both themes (the dark code block) is listed
 * below with its reason, so an exception is a decision rather than an accident.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = path.resolve(__dirname, '../..');

const FILES = ['pages/Chat.tsx', 'lib/formatChat.tsx', 'components/dashboard/AppSidebar.tsx'];

const FAMILIES = 'gray|slate|zinc|neutral|stone|blue|indigo|sky|white|black';
const HARDCODED = new RegExp(
  [
    `\\b(?:text|bg|border|ring|ring-offset|from|via|to|fill|stroke|placeholder|divide|outline|shadow|decoration|caret|accent)-(?:${FAMILIES})(?:-\\d{2,3})?(?:\\/[\\d.]+)?\\b`,
    '#[0-9a-fA-F]{3,8}\\b',
    '\\brgba?\\(',
  ].join('|'),
  'g',
);

/** Intentional fixed colours: file → exact line fragments allowed to keep them. */
const EXCEPTIONS: Record<string, string[]> = {
  // Fenced code blocks stay dark in both themes, like every editor and docs site.
  'lib/formatChat.tsx': ['bg-gray-900 text-gray-100'],
  // Categorical agent identity colours (Emma, Aria, Felix, Maya), not chrome.
  'pages/Chat.tsx': [
    "color: '#fce7f3', dot: '#f472b6'",
    "color: '#dbeafe', dot: '#60a5fa'",
    "color: '#dcfce7', dot: '#4ade80'",
    "color: '#ede9fe', dot: '#a78bfa'",
  ],
};

function hardcoded(file: string): string[] {
  const allowed = EXCEPTIONS[file] ?? [];
  return readFileSync(path.join(SRC, file), 'utf8')
    .split('\n')
    .flatMap((line, i) => {
      const scrubbed = allowed.reduce((l, frag) => l.split(frag).join(''), line);
      return [...scrubbed.matchAll(HARDCODED)].map((m) => `${file}:${i + 1} ${m[0]}`);
    });
}

describe('chat + sidebar colours', () => {
  it.each(FILES)('%s has no hardcoded neutral/blue/white/black colours', (file) => {
    expect(hardcoded(file)).toEqual([]);
  });

  it('every exception still exists (a stale allow-list hides nothing)', () => {
    for (const [file, frags] of Object.entries(EXCEPTIONS)) {
      const src = readFileSync(path.join(SRC, file), 'utf8');
      for (const frag of frags) expect(src, `${file}: ${frag}`).toContain(frag);
    }
  });
});
