/**
 * The exact worklist of status colours (red / amber / green / emerald …) still
 * hardcoded in chat, the sidebar, telephony and voice.
 *
 * They are deliberately not on theme tokens yet: no Tailwind status shade
 * equals --ok-* / --warn-* / --bad-fg, and dark mode needs on-status pairs that
 * slices 9/11 introduce. Until then this list is pinned, so a new hardcoded
 * status colour fails here instead of slipping in, and a migrated one fails
 * until it is struck off — the list only ever shrinks on purpose.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = path.resolve(__dirname, '../..');

const STATUS = /\b(?:text|bg|border|ring|ring-offset|from|via|to|fill|stroke|divide|outline|shadow|decoration|placeholder|caret|accent)-(?:red|rose|pink|orange|amber|yellow|lime|green|emerald|teal|cyan|violet|purple|fuchsia)(?:-\d{2,3})?(?:\/[\d.]+)?\b/g;

const WORKLIST: Record<string, string[]> = {
  'components/dashboard/AppSidebar.tsx': ['text-red-600'],
  'components/voice/ApprovalCard.tsx': ['bg-amber-500', 'bg-amber-600', 'text-amber-700 ×2', 'text-green-700', 'text-red-700'],
  'components/voice/MockedBadge.tsx': ['bg-amber-50 ×2', 'bg-amber-50/40', 'border-amber-200', 'border-amber-300', 'border-amber-300/70', 'text-amber-700', 'text-amber-800', 'text-amber-800/80'],
  'components/voice/analytics/sentimentCopy.ts': ['bg-amber-400', 'bg-amber-50', 'bg-amber-500', 'bg-emerald-400', 'bg-emerald-50', 'bg-emerald-500', 'border-amber-200', 'border-emerald-200', 'text-amber-800', 'text-emerald-800'],
  'components/voice/listen/ListenIn.tsx': ['bg-green-500'],
  'pages/Chat.tsx': ['bg-red-400', 'ring-red-50', 'text-red-500'],
  'pages/telephony/OwnerLoginPage.tsx': ['bg-amber-50', 'border-amber-200', 'text-amber-900'],
  'pages/telephony/_components/owner-calls/AppointmentSummary.tsx': ['bg-amber-50', 'border-amber-200', 'text-amber-900', 'text-green-700'],
  'pages/telephony/_components/owner-calls/BriefingSummary.tsx': ['text-amber-800', 'text-green-800'],
  'pages/telephony/_components/owner-calls/CallDetailPage.tsx': ['bg-green-50', 'border-green-300', 'text-green-800'],
  'pages/telephony/_components/owner-calls/CallsListView.tsx': ['text-green-700'],
  'pages/telephony/_components/owner-calls/LiveCallsSection.tsx': ['bg-green-50/40', 'border-green-200'],
  'pages/telephony/_components/owner-calls/ResultChip.tsx': ['bg-amber-50', 'bg-green-400', 'bg-green-50 ×3', 'bg-green-500', 'bg-red-50', 'border-amber-200', 'border-green-200 ×3', 'border-red-200', 'text-amber-800', 'text-green-800 ×3', 'text-red-800'],
  'pages/telephony/_components/owner-calls/TranscriptView.tsx': ['bg-amber-50', 'ring-amber-300', 'text-amber-800'],
  'pages/telephony/_components/policies/PoliciesView.tsx': ['text-amber-700', 'text-green-700'],
  'pages/telephony/_components/settings/VoiceSettingsView.tsx': ['text-amber-700', 'text-green-700'],
  'pages/telephony/_components/sidebar/TelephonyMiniRail.tsx': ['bg-amber-400', 'bg-green-400', 'bg-green-500'],
  'pages/telephony/_components/threads/ThreadBits.tsx': ['bg-amber-500', 'text-amber-600'],
  'pages/telephony/_components/threads/ThreadDetailView.tsx': ['bg-amber-50', 'border-amber-200', 'text-amber-700'],
  'pages/telephony/_components/threads/ThreadManageModals.tsx': ['bg-amber-50', 'bg-amber-50/60', 'text-amber-800 ×2'],
  'pages/telephony/_components/threads/ThreadsView.tsx': ['accent-amber-500', 'bg-red-50', 'border-red-200', 'text-red-700'],
  'pages/telephony/_components/voice/AppointmentPanel.tsx': ['bg-amber-50', 'bg-green-50', 'bg-green-600', 'bg-red-50', 'bg-red-500', 'border-amber-200', 'border-green-200', 'border-green-600', 'border-red-200', 'border-red-500', 'text-amber-800', 'text-amber-800/70', 'text-amber-800/90 ×2', 'text-green-600', 'text-green-700', 'text-red-700 ×2'],
  'pages/telephony/_components/voice/BriefingPanel.tsx': ['bg-amber-50', 'bg-green-50', 'border-amber-200', 'border-green-200', 'text-amber-800', 'text-green-600', 'text-green-800'],
  'pages/telephony/_components/voice/CallActionsTimeline.tsx': ['bg-amber-50/60', 'bg-red-50/60', 'border-amber-300', 'border-red-100', 'text-amber-800', 'text-amber-800/80', 'text-amber-900', 'text-amber-900/60', 'text-amber-900/75', 'text-green-600', 'text-red-800'],
  'pages/telephony/_components/voice/CallChips.tsx': ['text-amber-700', 'text-green-600'],
  'pages/telephony/_components/voice/CallDetailBody.tsx': ['text-amber-600'],
  'pages/telephony/_components/voice/CallOutcomePanel.tsx': ['bg-amber-50', 'bg-green-50', 'text-amber-500', 'text-amber-700', 'text-green-500', 'text-green-600 ×2', 'text-green-700 ×4', 'text-red-500'],
  'pages/telephony/_components/voice/LatencyPanel.tsx': ['bg-amber-400', 'bg-amber-500/50', 'bg-green-500/50', 'text-amber-700', 'text-green-700', 'text-red-600'],
  'pages/telephony/_components/voice/LimitsStrip.tsx': ['bg-amber-500', 'bg-red-500', 'text-amber-700', 'text-red-500 ×2', 'text-red-600'],
  'pages/telephony/_components/voice/LiveCallModal.tsx': ['bg-amber-50/70', 'bg-green-50', 'bg-green-500 ×3', 'border-amber-300', 'border-red-200', 'text-amber-600', 'text-amber-700 ×2', 'text-green-700', 'text-red-600'],
  'pages/telephony/_components/voice/LiveView.tsx': ['bg-green-50', 'bg-green-500', 'bg-green-700', 'text-green-600', 'text-green-700'],
  'pages/telephony/_components/voice/MessagesView.tsx': ['bg-amber-50', 'bg-amber-500', 'border-amber-200', 'text-amber-800'],
  'pages/telephony/_components/voice/PendingApprovalView.tsx': ['bg-amber-50', 'bg-green-50', 'border-amber-200', 'border-green-200', 'text-amber-700', 'text-green-500', 'text-green-700'],
  'pages/telephony/_components/voice/PolicyPanel.tsx': ['bg-amber-50', 'border-amber-300', 'text-amber-700', 'text-amber-800', 'text-amber-900'],
  'pages/telephony/_components/voice/ReceptionistPanel.tsx': ['bg-green-600'],
  'pages/telephony/_components/voice/StartCallModal.tsx': ['bg-red-50 ×3', 'border-red-200 ×3', 'border-red-300', 'text-green-600', 'text-red-500 ×2', 'text-red-600 ×3', 'text-red-700 ×3', 'text-red-700/80'],
  'pages/telephony/_components/voice/TranscriptModal.tsx': ['bg-amber-200', 'text-amber-600 ×2', 'text-green-500'],
  'pages/telephony/_components/voice/VoicePage.tsx': ['bg-green-50 ×2', 'bg-green-500 ×4', 'bg-red-400', 'bg-red-50 ×2', 'border-green-200', 'border-red-200 ×2', 'text-green-600 ×2', 'text-green-700 ×2', 'text-red-500 ×2', 'text-red-600 ×2', 'text-red-700'],
  'pages/telephony/_lib/voiceMeta.ts': ['bg-amber-50', 'bg-green-50', 'bg-red-50', 'border-amber-200', 'border-green-200', 'border-red-200', 'text-amber-700', 'text-green-700', 'text-red-700'],
};

function walk(dir: string): string[] {
  return readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return walk(rel);
    return /\.(tsx?|css)$/.test(e.name) ? [rel] : [];
  });
}

const FILES = ['pages/Chat.tsx', 'lib/formatChat.tsx', 'components/dashboard/AppSidebar.tsx', ...['pages/telephony', 'components/voice'].flatMap(walk)];

function statusColours(file: string): string[] {
  const counts = new Map<string, number>();
  for (const m of readFileSync(path.join(SRC, file), 'utf8').matchAll(STATUS)) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  return [...counts].map(([cls, n]) => (n > 1 ? `${cls} ×${n}` : cls)).sort();
}

describe('status colour worklist (slices 9/11)', () => {
  it('matches the pinned list exactly', () => {
    const actual = Object.fromEntries(FILES.map((f) => [f, statusColours(f)]).filter(([, v]) => v.length));
    expect(actual).toEqual(WORKLIST);
  });
});
