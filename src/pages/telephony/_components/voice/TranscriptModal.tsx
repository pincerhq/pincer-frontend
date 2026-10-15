/**
 * Full-size transcript workspace for one call.
 *
 * The inline panel on the Voice page is for a quick glance; this modal is for
 * actually working with a transcript: search with highlighting, filter by
 * speaker, toggle timestamps/confidence, copy any line, copy or download the
 * whole thing (.txt for humans, .json for tooling). Everything operates on the
 * already-fetched CallDetail — no extra endpoints needed.
 */
import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileJson,
  Inbox,
  Search,
  X,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useCallDetail, type TranscriptLine } from '@/lib/api/voice';
import CallOutcomePanel, { parseOutcome } from '@/pages/telephony/_components/voice/CallOutcomePanel';
import AppointmentPanel from '@/pages/telephony/_components/voice/AppointmentPanel';
import LatencyPanel from '@/pages/telephony/_components/voice/LatencyPanel';
import CallActionsTimeline from '@/pages/telephony/_components/voice/CallActionsTimeline';
import BriefingPanel from '@/pages/telephony/_components/voice/BriefingPanel';
import CostPanel from '@/pages/telephony/_components/voice/CostPanel';
import AnalyticsPanel from '@/components/voice/analytics/AnalyticsPanel';
import {
  BriefingDivider,
  CostCell,
  LanguageFlag,
  LanguageSwitchDivider,
  OutcomeChip,
} from '@/pages/telephony/_components/voice/CallChips';
import {
  CHIP_TONE_CLASS,
  intentMeta,
  parseBriefingLine,
  parseLanguageSwitch,
} from '@/pages/telephony/_lib/voiceMeta';
import { Link } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

function fmtDuration(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function fmtTime(ts: string) {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleTimeString();
}

/** Case-insensitive <mark> highlighting of the search query. */
function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="rounded-sm bg-amber-200 px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

type SpeakerFilter = 'all' | 'agent' | 'caller' | 'other';

function speakerBucket(speaker: string): Exclude<SpeakerFilter, 'all'> {
  if (speaker === 'agent') return 'agent';
  if (speaker === 'caller') return 'caller';
  return 'other';
}

function lineToText(t: TranscriptLine, withTime: boolean): string {
  const time = withTime ? `[${fmtTime(t.timestamp)}] ` : '';
  return `${time}${t.speaker.toUpperCase()}: ${t.text}`;
}

/** Where this call sits in its thread, and how to walk the neighbours (§4.2). */
export interface ThreadNav {
  threadId: string;
  subject: string;
  /** 1-based, for "call 2/3". */
  index: number;
  total: number;
  onPrev?: () => void;
  onNext?: () => void;
}

export default function TranscriptModal({
  callSid,
  open,
  onClose,
  threadNav,
}: {
  callSid: string;
  open: boolean;
  onClose: () => void;
  threadNav?: ThreadNav;
}) {
  const { data: d, isLoading } = useCallDetail(open ? callSid : null);
  const { toast } = useToast();

  const [query, setQuery] = useState('');
  const [speaker, setSpeaker] = useState<SpeakerFilter>('all');
  const [showTimes, setShowTimes] = useState(true);
  const [showConfidence, setShowConfidence] = useState(false);
  const [copiedLine, setCopiedLine] = useState<number | null>(null);

  const lines = useMemo(() => {
    if (!d) return [];
    return d.transcript
      .map((t, index) => ({ ...t, index }))
      .filter((t) => speaker === 'all' || speakerBucket(t.speaker) === speaker)
      .filter((t) => !query.trim() || t.text.toLowerCase().includes(query.toLowerCase()));
  }, [d, speaker, query]);

  const matchCount = query.trim() ? lines.length : null;

  const copyAll = async () => {
    if (!d) return;
    const text = d.transcript.map((t) => lineToText(t, showTimes)).join('\n');
    await navigator.clipboard.writeText(text);
    toast({ title: 'Transcript copied', description: `${d.transcript.length} lines` });
  };

  const copyLine = async (t: TranscriptLine & { index: number }) => {
    await navigator.clipboard.writeText(lineToText(t, showTimes));
    setCopiedLine(t.index);
    setTimeout(() => setCopiedLine(null), 1200);
  };

  const download = (kind: 'txt' | 'json') => {
    if (!d) return;
    const blob =
      kind === 'txt'
        ? new Blob([d.transcript.map((t) => lineToText(t, true)).join('\n')], {
            type: 'text/plain',
          })
        : new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${callSid}-transcript.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const speakerPills: { id: SpeakerFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'agent', label: 'Agent' },
    { id: 'caller', label: 'Caller' },
    { id: 'other', label: 'System' },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex h-[92vh] w-[94vw] max-w-[1500px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1500px]"
        // ←/→ walk the thread while the panel has focus (§4.2). Typing in the
        // search box must still move the caret, not the call.
        onKeyDown={(e) => {
          if (!threadNav) return;
          const tag = (e.target as HTMLElement).tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA') return;
          if (e.key === 'ArrowLeft' && threadNav.onPrev) {
            e.preventDefault();
            threadNav.onPrev();
          }
          if (e.key === 'ArrowRight' && threadNav.onNext) {
            e.preventDefault();
            threadNav.onNext();
          }
        }}
      >
        {/* Header */}
        <div className="border-b border-[var(--line-soft)] px-6 py-4">
          {threadNav && (
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <Link
                to={`/telephony/threads/${encodeURIComponent(threadNav.threadId)}`}
                className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--text-3)] transition-colors hover:text-[var(--ink)]"
                title={`Open thread: ${threadNav.subject}`}
              >
                <span aria-hidden="true">🧵</span>
                <span className="max-w-[420px] truncate underline decoration-dotted">{threadNav.subject}</span>
              </Link>
              <span className="text-xs text-[var(--text-5)]">
                · call {threadNav.index}/{threadNav.total}
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={threadNav.onPrev}
                  disabled={!threadNav.onPrev}
                  className="rounded-full border border-[var(--line)] p-1 text-[var(--text-4)] transition-colors hover:bg-[var(--sand)] hover:text-[var(--ink)] disabled:opacity-40"
                  aria-label="Previous call in thread"
                  title="Previous call in thread (←)"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={threadNav.onNext}
                  disabled={!threadNav.onNext}
                  className="rounded-full border border-[var(--line)] p-1 text-[var(--text-4)] transition-colors hover:bg-[var(--sand)] hover:text-[var(--ink)] disabled:opacity-40"
                  aria-label="Next call in thread"
                  title="Next call in thread (→)"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          )}
          <DialogTitle className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-base font-semibold text-[var(--ink)]">
            Transcript
            <span className="font-mono text-xs font-normal text-[var(--text-5)]">{callSid}</span>
          </DialogTitle>
          {d && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-4)]">
              <span className="flex items-center gap-1">
                {d.direction === 'outbound' ? (
                  <ArrowUpRight className="h-3.5 w-3.5 text-[var(--text-5)]" />
                ) : (
                  <ArrowDownLeft className="h-3.5 w-3.5 text-[var(--text-5)]" />
                )}
                {d.direction === 'outbound' ? d.to_number : d.from_number}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-[var(--text-5)]" />
                {fmtDuration(d.duration_seconds)}
              </span>
              <span>{new Date(d.started_at).toLocaleString()}</span>
              <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-3)]">
                {d.status}
              </span>
              <LanguageFlag language={d.language} />
              <OutcomeChip call={d} />
              {/* Inbound calls carry why they came in, and message-intent calls
                  deep-link to the entry the receptionist left in the inbox. */}
              {d.inbound_intent && (
                <span
                  title={intentMeta(d.inbound_intent)?.title}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                    CHIP_TONE_CLASS[intentMeta(d.inbound_intent)?.tone ?? 'grey'],
                  )}
                >
                  {intentMeta(d.inbound_intent)?.label}
                </span>
              )}
              {String(d.inbound_intent) === 'message' && (
                <Link
                  to="/telephony/messages"
                  className="flex items-center gap-1 font-medium text-[var(--text-3)] underline decoration-dotted hover:text-[var(--ink)]"
                >
                  <Inbox className="h-3.5 w-3.5" />
                  Open in inbox
                </Link>
              )}
              {d.cost_total_usd != null && <CostCell usd={d.cost_total_usd} />}
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line-soft)] bg-[color:color-mix(in_srgb,var(--ink)_2%,transparent)] px-6 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-5)]" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search transcript…"
              className="h-8 w-72 bg-[var(--paper)] pl-8 text-xs"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-5)] hover:text-[var(--text-3)]"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {matchCount !== null && (
            <span className="text-[11px] text-[var(--text-5)]">
              {matchCount} {matchCount === 1 ? 'match' : 'matches'}
            </span>
          )}

          <div className="flex items-center rounded-full border border-[var(--line)] bg-[var(--paper)] p-0.5">
            {speakerPills.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSpeaker(p.id)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                  speaker === p.id ? 'bg-[var(--ink)] text-[var(--on-ink)]' : 'text-[var(--text-4)] hover:text-[var(--ink)]',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--text-4)]">
            <input
              type="checkbox"
              checked={showTimes}
              onChange={(e) => setShowTimes(e.target.checked)}
              className="h-3 w-3 rounded border-[var(--line)]"
            />
            timestamps
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--text-4)]">
            <input
              type="checkbox"
              checked={showConfidence}
              onChange={(e) => setShowConfidence(e.target.checked)}
              className="h-3 w-3 rounded border-[var(--line)]"
            />
            confidence
          </label>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={copyAll}
              className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--paper)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-3)] hover:bg-[var(--sand)]"
            >
              <Copy className="h-3 w-3" /> Copy all
            </button>
            <button
              type="button"
              onClick={() => download('txt')}
              className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--paper)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-3)] hover:bg-[var(--sand)]"
            >
              <Download className="h-3 w-3" /> .txt
            </button>
            <button
              type="button"
              onClick={() => download('json')}
              className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--paper)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-3)] hover:bg-[var(--sand)]"
            >
              <FileJson className="h-3 w-3" /> .json
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {/* Transcript */}
          <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-8 py-5">
            {isLoading && <div className="text-sm text-[var(--text-5)]">Loading…</div>}
            {d && lines.length === 0 && (
              <div className="text-sm text-[var(--text-5)]">
                {d.transcript.length === 0 ? 'No transcript recorded.' : 'Nothing matches the current filters.'}
              </div>
            )}
            <div className="space-y-3">
              {lines.map((t) => {
                // Language switches are SYSTEM entries, not speech: they get a
                // divider rather than a speaker row.
                const sw = parseLanguageSwitch(t);
                if (sw) return <LanguageSwitchDivider key={t.index} sw={sw} />;
                // The briefing was handed to the agent, not spoken to anyone.
                const briefed = parseBriefingLine(t);
                if (briefed !== null) return <BriefingDivider key={t.index} text={briefed} />;
                return (
                <div
                  key={t.index}
                  className="group -mx-2 flex items-start gap-3 rounded-[8px] px-2 py-0.5 transition-colors hover:bg-[var(--sand)]"
                >
                  {showTimes && (
                    <span className="w-[72px] shrink-0 pt-0.5 font-mono text-[10px] text-[var(--text-5)]">
                      {fmtTime(t.timestamp)}
                    </span>
                  )}
                  <span
                    className={cn(
                      'w-14 shrink-0 pt-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      speakerBucket(t.speaker) === 'agent'
                        ? 'text-[var(--brand)]'
                        : speakerBucket(t.speaker) === 'caller'
                          ? 'text-[var(--text-4)]'
                          : 'text-[var(--text-5)]',
                    )}
                  >
                    {t.speaker}
                  </span>
                  <div className="min-w-0 flex-1 break-words">
                    <span
                      className={cn(
                        'text-sm leading-relaxed',
                        speakerBucket(t.speaker) === 'agent' ? 'text-[var(--text-2)]' : 'text-[var(--ink)]',
                      )}
                    >
                      <Highlighted text={t.text} query={query} />
                    </span>
                    {showConfidence && (
                      <span
                        className={cn(
                          'ml-2 font-mono text-[10px]',
                          t.confidence < 0.8 ? 'text-amber-600' : 'text-[var(--text-5)]',
                        )}
                      >
                        {Math.round(t.confidence * 100)}%
                      </span>
                    )}
                    {t.state === 'undelivered' && (
                      <span className="ml-2 text-[10px] text-amber-600">⚠ not delivered as audio</span>
                    )}
                    {/* At the end of the text, not the far edge of the row:
                        floated right it appeared far from its own line. */}
                    <button
                      type="button"
                      onClick={() => copyLine(t)}
                      className="ml-1.5 inline-flex translate-y-0.5 rounded p-0.5 text-[var(--text-5)] opacity-0 transition-opacity hover:bg-[var(--sand-deep)] hover:text-[var(--text-3)] focus-visible:opacity-100 group-hover:opacity-100"
                      aria-label="Copy line"
                    >
                      {copiedLine === t.index ? (
                        <Check className="h-3 w-3 text-green-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          </div>

          {/* The record of the call, in the order someone reads it: what the
              agent was told, how it went, what came of it, and what it cost.
              The transcript on the left is the evidence for all of it. */}
          {d && (
            <aside className="plat-scroll-y w-[360px] shrink-0 overflow-y-auto overflow-x-hidden border-l border-[var(--line-soft)] bg-[color:color-mix(in_srgb,var(--ink)_1.5%,transparent)] px-4 py-4">
              <BriefingPanel call={d} />
              <AnalyticsPanel call={d} />
              <CallOutcomePanel detail={d} />
              {d.appointment && (
                <div className="mb-3">
                  <AppointmentPanel appointment={d.appointment} />
                </div>
              )}
              {d.latency && (
                <div className="mb-3">
                  <LatencyPanel latency={d.latency} />
                </div>
              )}
              <CostPanel cost={d.cost} />
              <CallActionsTimeline actions={d.actions.filter((a) => !parseOutcome(a))} />
            </aside>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
