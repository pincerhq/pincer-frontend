/**
 * How the call went: who talked, and how the caller seemed while they did.
 *
 * This replaces the placeholder that carried the "Sentiment & talk ratio" mock
 * badge — the numbers are now measured (or, on ConversationRelay, inferred and
 * labelled as inferred) rather than promised.
 */
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import type { CallDetail } from '@/lib/api/voice';
import SentimentChip from './SentimentChip';
import TalkRatioBar from './TalkRatioBar';
import { SENTIMENT_HEADING, t, type Bilingual } from './sentimentCopy';

const TALK_HEADING: Bilingual = { en: 'Talk time', de: 'Redeanteil' };
const TITLE: Bilingual = { en: 'How the call went', de: 'Gesprächsverlauf' };

export default function AnalyticsPanel({ call }: { call: CallDetail }) {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const analytics = call.analytics ?? null;

  return (
    <section className="mb-3 rounded-[10px] border border-[var(--line)] bg-[var(--paper)] p-3">
      <h4 className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ink)]">
        <Activity className="h-3.5 w-3.5 text-[var(--text-4)]" />
        {t(TITLE, lang)}
      </h4>

      <div className="mt-2.5 space-y-3">
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--text-5)]">
            {t(TALK_HEADING, lang)}
          </p>
          <TalkRatioBar analytics={analytics} />
        </div>

        <div className="border-t border-[var(--line-soft)] pt-3">
          <p className="mb-1.5 text-[10px] uppercase tracking-wide text-[var(--text-5)]">
            {t(SENTIMENT_HEADING, lang)}
          </p>
          <SentimentChip analytics={analytics} />
        </div>
      </div>
    </section>
  );
}
