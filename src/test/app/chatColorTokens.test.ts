/**
 * Chat, the app sidebar, telephony and the shared voice components take every
 * neutral colour from the theme tokens.
 *
 * A hardcoded `text-gray-700` or `#14161a` looks right in light mode and stays
 * exactly that colour in dark mode, which is how a page ends up half-themed.
 * Anything that must stay fixed is listed below with its reason, so an
 * exception is a decision rather than an accident. Status colours (red, amber,
 * green) are not neutral and are out of this guard's scope; slices 9/11 own them.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = path.resolve(__dirname, '../..');

const DIRS = ['pages/telephony', 'components/voice'];

const FAMILIES = 'gray|slate|zinc|neutral|stone|blue|indigo|sky|white|black';
const HARDCODED = new RegExp(
  [
    `\\b(?:text|bg|border|ring|ring-offset|from|via|to|fill|stroke|placeholder|divide|outline|shadow|decoration|caret|accent)-(?:${FAMILIES})(?:-\\d{2,3})?(?:\\/[\\d.]+)?\\b`,
    '#[0-9a-fA-F]{3,8}\\b',
    // No leading \b: inside an arbitrary value (`shadow-[0_2px_rgba(…)]`) the
    // preceding `_` is a word character, so a boundary would never match.
    'rgba?\\(',
  ].join('|'),
  'g',
);

/** Intentional fixed colours: file → exact line fragments allowed to keep them. */
const EXCEPTIONS: Record<string, string[]> = {
  // Fenced code blocks stay dark in both themes, like every editor and docs site.
  'lib/formatChat.tsx': ['bg-[#22231f] text-[#eeefe8]'],
  // Categorical risk scale R / W / X: W's blue is a rung on the scale, not the brand.
  'pages/telephony/_lib/voiceMeta.ts': ["cls: 'border-blue-200 bg-blue-50 text-blue-700'"],
  // Categorical sentiment set (positive / neutral / mixed / negative): themed per role in
  // src/styles/status-colors.css, so the classes stay and both themes get their own values.
  'components/voice/analytics/sentimentCopy.ts': [
    "dotClass: 'bg-zinc-400'",
    "chipClass: 'border-zinc-200 bg-zinc-50 text-zinc-700'",
    "barClass: 'bg-zinc-400'",
    "dotClass: 'bg-sky-500'",
    "chipClass: 'border-sky-200 bg-sky-50 text-sky-800'",
    "barClass: 'bg-sky-400'",
  ],
  // Approval countdown ring: an SVG stroke can't take a Tailwind class, so the amber middle
  // stage reads the themed status variable (src/styles/status-colors.css) directly.
  'components/voice/ApprovalCard.tsx': ["'rgb(var(--st-amber-700))'"],
};

function walk(dir: string): string[] {
  return readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return walk(rel);
    return /\.(tsx?|css)$/.test(e.name) ? [rel] : [];
  });
}

const FILES = ['pages/Chat.tsx', 'lib/formatChat.tsx', 'components/dashboard/AppSidebar.tsx', ...DIRS.flatMap(walk)];

function hardcoded(file: string): string[] {
  const allowed = EXCEPTIONS[file] ?? [];
  return readFileSync(path.join(SRC, file), 'utf8')
    .split('\n')
    .flatMap((line, i) => {
      const scrubbed = allowed.reduce((l, frag) => l.split(frag).join(''), line);
      return [...scrubbed.matchAll(HARDCODED)].map((m) => `${file}:${i + 1} ${m[0]}`);
    });
}

describe('theme-token colours: chat, sidebar, telephony, voice', () => {
  it('walks the telephony and voice folders', () => {
    expect(FILES.filter((f) => f.startsWith('pages/telephony/')).length).toBeGreaterThan(40);
    expect(FILES.filter((f) => f.startsWith('components/voice/')).length).toBeGreaterThan(5);
  });

  it.each(FILES)('%s has no hardcoded neutral/blue/white/black colours', (file) => {
    expect(hardcoded(file)).toEqual([]);
  });

  // A shadow tinted with ink glows once ink turns light in dark mode; --shade
  // is ink in light and black in dark.
  it('shadows are tinted with --shade, never --ink', () => {
    const inkShadows = FILES.flatMap((file) =>
      readFileSync(path.join(SRC, file), 'utf8')
        .split('\n')
        .flatMap((line, i) => (/shadow-\[[^\]]*var\(--ink\)/.test(line) ? [`${file}:${i + 1}`] : [])),
    );
    expect(inkShadows).toEqual([]);
  });

  it('every exception still exists (a stale allow-list hides nothing)', () => {
    for (const [file, frags] of Object.entries(EXCEPTIONS)) {
      const src = readFileSync(path.join(SRC, file), 'utf8');
      for (const frag of frags) expect(src, `${file}: ${frag}`).toContain(frag);
    }
  });
});
