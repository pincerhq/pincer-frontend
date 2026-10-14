/**
 * The inside of a call: appointment, latency, transcript, actions.
 *
 * Extracted from the Voice page's side panel so the thread timeline (S14 §3.4)
 * can expand a call in place without a second, drifting transcript renderer.
 * One call detail, three places: the side panel, the full-screen modal's
 * neighbours, and the timeline.
 */
import { cn } from '@/lib/utils';
import { parseBriefingLine, parseLanguageSwitch } from '@/pages/telephony/_lib/voiceMeta';
import { BriefingDivider, LanguageSwitchDivider } from './CallChips';
import AppointmentPanel from './AppointmentPanel';
import BriefingPanel from './BriefingPanel';
import AnalyticsPanel from '@/components/voice/analytics/AnalyticsPanel';
import LatencyPanel from './LatencyPanel';
import CallActionsTimeline from './CallActionsTimeline';
import type { CallDetail } from '@/lib/api/voice';

/** What retention leaves behind: the call happened, the words are gone. */
export function PurgedTranscriptNote() {
  return (
    <p className="rounded-[10px] border border-dashed border-[var(--line)] bg-[var(--sand)] px-3 py-4 text-center text-xs text-[var(--text-5)]">
      Transcript removed per retention policy
    </p>
  );
}

export function CallTranscript({
  detail,
  purged = false,
  maxHeightClass = 'max-h-96',
}: {
  detail: CallDetail;
  purged?: boolean;
  maxHeightClass?: string;
}) {
  if (purged) return <PurgedTranscriptNote />;
  if (!detail.transcript.length) {
    return <div className="text-sm text-[var(--text-5)]">No transcript recorded.</div>;
  }
  return (
    <div className={cn('space-y-2 overflow-y-auto pr-2', maxHeightClass)}>
      {detail.transcript.map((t, i) => {
        // A SYSTEM language-switch entry is not a line anyone said — it reads
        // as a divider between the two halves of the conversation.
        const sw = parseLanguageSwitch(t);
        if (sw) return <LanguageSwitchDivider key={i} sw={sw} />;
        // Same for the briefing the agent was handed before the first word.
        const briefed = parseBriefingLine(t);
        if (briefed !== null) return <BriefingDivider key={i} text={briefed} />;
        return (
          <div key={i}>
            <span
              className={cn(
                'mr-2 text-[10px] font-semibold uppercase tracking-wide',
                t.speaker === 'agent' ? 'text-[var(--brand)]' : 'text-[var(--text-5)]',
              )}
            >
              {t.speaker}
            </span>
            <span className={cn('text-sm', t.speaker === 'agent' ? 'text-[var(--text-2)]' : 'text-[var(--ink)]')}>
              {t.text}
            </span>
            {t.state === 'undelivered' && (
              <span className="ml-2 text-[10px] text-amber-600">⚠ not delivered as audio</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function CallDetailBody({
  detail,
  purged = false,
  maxHeightClass,
}: {
  detail: CallDetail;
  /** Retention stub: keep the entry, drop the words — never an error state. */
  purged?: boolean;
  maxHeightClass?: string;
}) {
  return (
    <>
      {/* First: what the agent was told. Everything below is evidence. */}
      <BriefingPanel call={detail} />
      {/* Then how it actually went — measured, not promised (S16). */}
      <AnalyticsPanel call={detail} />
      {detail.appointment && (
        <div className="mb-3">
          <AppointmentPanel appointment={detail.appointment} />
        </div>
      )}
      {detail.latency && (
        <div className="mb-3">
          <LatencyPanel latency={detail.latency} />
        </div>
      )}
      <CallTranscript detail={detail} purged={purged} maxHeightClass={maxHeightClass} />
      <CallActionsTimeline actions={detail.actions} compact />
    </>
  );
}
