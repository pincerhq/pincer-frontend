/**
 * Who did the talking, as a bar.
 *
 * Three segments that must add to 100 on screen — agent, caller, silence —
 * so the rounding is largest-remainder rather than three independent
 * `Math.round`s (see `talkMath.ts`). On the ConversationRelay engine the
 * numbers are inferred from text length, and every one of them is marked as
 * such.
 */
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { CallAnalytics } from '@/lib/api/voice';
import { clock, sharePercents } from './talkMath';
import {
  ESTIMATED_MARK,
  ESTIMATED_TOOLTIP,
  NO_SPEECH,
  TALK_LABEL,
  isEstimated,
  spokenOf,
  t,
} from './sentimentCopy';

export default function TalkRatioBar({ analytics }: { analytics: CallAnalytics | null | undefined }) {
  const { i18n } = useTranslation();
  const lang = i18n.language;

  const agentMs = analytics?.agent_speech_ms ?? null;
  const callerMs = analytics?.caller_speech_ms ?? null;
  const speech = (agentMs ?? 0) + (callerMs ?? 0);

  // A voicemail, a no-answer, or a call from before the feature: one line, no bar.
  if (agentMs == null || callerMs == null || speech <= 0) {
    return <p className="text-[12px] text-[var(--text-5)]">{t(NO_SPEECH, lang)}</p>;
  }

  const silenceMs = Math.max(0, analytics?.silence_ms ?? 0);
  const [agentPct, callerPct, silencePct] = sharePercents([agentMs, callerMs, silenceMs]);
  // The headline split is of speech only — silence is not a speaker.
  const [agentOfSpeech, callerOfSpeech] = sharePercents([agentMs, callerMs]);
  const estimated = isEstimated(analytics?.method);
  const interruptions = analytics?.interruptions ?? 0;

  const mark = estimated ? (
    <sup title={t(ESTIMATED_TOOLTIP, lang)} className="ml-0.5 cursor-help text-[var(--text-5)]">
      {ESTIMATED_MARK}
    </sup>
  ) : null;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
        <span className="text-[var(--text-2)]">
          {t(TALK_LABEL.agent, lang)} {agentOfSpeech}%{mark}
        </span>
        <span className="text-[var(--text-5)]">·</span>
        <span className="text-[var(--text-2)]">
          {t(TALK_LABEL.caller, lang)} {callerOfSpeech}%{estimated && mark}
        </span>
        {silencePct > 0 && (
          <span className="text-[var(--text-5)]">
            · {silencePct}% {t(TALK_LABEL.silence, lang)}
          </span>
        )}
      </div>

      <div
        className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-[var(--sand-deep)]"
        role="img"
        aria-label={`${t(TALK_LABEL.agent, lang)} ${agentOfSpeech}%, ${t(TALK_LABEL.caller, lang)} ${callerOfSpeech}%, ${silencePct}% ${t(TALK_LABEL.silence, lang)}`}
      >
        <span className="bg-[var(--ink)]" style={{ width: `${agentPct}%` }} />
        <span className="bg-[var(--brand)]" style={{ width: `${callerPct}%` }} />
        {/* Silence is present but muted: it is the absence of both speakers. */}
        <span className="bg-[var(--sand-deep)] opacity-70" style={{ width: `${silencePct}%` }} />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-5)]">
        <span>{spokenOf(clock(speech), clock(speech + silenceMs), lang)}</span>
        {interruptions > 0 && (
          <span className={cn('text-[var(--text-4)]')}>
            ↯ {interruptions} {t(TALK_LABEL.interruptions, lang)}
          </span>
        )}
      </div>
    </div>
  );
}
