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

/** White text or a white dot on a status fill: it pairs with the fill, which slices 9/11 retune. */
const ON_STATUS_FILL = 'white on a status fill — src/styles/status-colors.css deepens the fill under it to 4.5:1';

/** Intentional fixed colours: file → exact line fragments allowed to keep them. */
const EXCEPTIONS: Record<string, string[]> = {
  // Fenced code blocks stay dark in both themes, like every editor and docs site.
  'lib/formatChat.tsx': ['bg-[#22231f] text-[#eeefe8]'],
  // ON_STATUS_FILL
  'pages/telephony/_components/sidebar/TelephonyMiniRail.tsx': [
    'bg-green-500 text-[9px] font-bold leading-none text-white',
    'bg-amber-400 px-1 text-[9px] font-bold leading-none text-white',
  ],
  'pages/telephony/_components/voice/AppointmentPanel.tsx': [
    'border-green-600 bg-green-600 text-white',
    'border-red-500 bg-red-500 text-white',
  ],
  'pages/telephony/_components/voice/VoicePage.tsx': ['bg-green-500 px-2 py-0.5 text-[10px] font-semibold text-white'],
  'pages/telephony/_components/voice/LiveView.tsx': [
    'bg-green-700 px-2.5 py-1 text-xs font-semibold text-white',
    'h-1.5 w-1.5 animate-pulse rounded-full bg-white',
  ],
  'pages/telephony/_components/voice/LiveCallModal.tsx': ['bg-[var(--bad-fg)] px-2.5 py-1 text-[11px] font-semibold text-white'],
  'pages/telephony/_components/voice/ReceptionistPanel.tsx': ['bg-[var(--bad-fg)] px-2.5 py-1 text-[10px] font-semibold text-white'],
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
void ON_STATUS_FILL;

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

  it('every exception still exists (a stale allow-list hides nothing)', () => {
    for (const [file, frags] of Object.entries(EXCEPTIONS)) {
      const src = readFileSync(path.join(SRC, file), 'utf8');
      for (const frag of frags) expect(src, `${file}: ${frag}`).toContain(frag);
    }
  });
});
