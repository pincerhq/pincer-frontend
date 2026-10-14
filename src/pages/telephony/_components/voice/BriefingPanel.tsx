/**
 * What the agent was told to do, and whether anything came of it.
 *
 * This is the panel that closes the trust loop: the user wrote a purpose, and
 * this shows the text the backend actually bound to the call — not what a form
 * once submitted. If the two ever differ, what is on screen is the truth.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ClipboardCopy, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CHIP_TONE_CLASS } from '@/pages/telephony/_lib/voiceMeta';
import type { CallDetail } from '@/lib/api/voice';

const SOURCE_LABEL: Record<string, { en: string; de: string }> = {
  dashboard: { en: 'from the dashboard', de: 'aus dem Dashboard' },
  chat: { en: 'from chat', de: 'aus dem Chat' },
  telegram: { en: 'from Telegram', de: 'aus Telegram' },
  api: { en: 'via the API', de: 'über die API' },
  scheduler: { en: 'scheduled', de: 'geplant' },
};

const T = {
  title: { en: 'Briefing', de: 'Anweisung' },
  none: { en: 'No briefing recorded (older call)', de: 'Keine Anweisung gespeichert (älterer Anruf)' },
  copy: { en: 'Copy the briefing', de: 'Anweisung kopieren' },
  copied: { en: 'Copied', de: 'Kopiert' },
  result: { en: 'Result', de: 'Ergebnis' },
  noResult: {
    en: 'No task result was extracted — check the transcript.',
    de: 'Kein Aufgaben-Ergebnis extrahiert — bitte das Transkript prüfen.',
  },
  failed: {
    en: 'The call did not happen, so there is nothing to judge the briefing against.',
    de: 'Der Anruf kam nicht zustande — die Anweisung lässt sich daran nicht messen.',
  },
} as const;

const pick = (entry: { en: string; de: string }, lang?: string) =>
  lang?.startsWith('de') ? entry.de : entry.en;

/**
 * Adherence, from data that already exists (no new backend): a task result is
 * the agent reporting it did the job; its absence on a completed call is worth
 * a look; a failed call gets no judgement at all.
 */
function AdherenceStrip({ call, lang }: { call: CallDetail; lang?: string }) {
  const failed = !!call.failure_code && call.failure_code !== 'none';
  const taskResult = call.outcome?.task_result?.trim();
  const completed = call.status === 'completed' || !!call.ended_at;

  if (failed) {
    return (
      <p className="mt-3 text-[11.5px] text-[var(--text-5)]">{pick(T.failed, lang)}</p>
    );
  }
  if (taskResult) {
    return (
      <p className="mt-3 rounded-[10px] border border-green-200 bg-green-50 px-3 py-2 text-[12px] text-green-800">
        <span className="font-semibold">{pick(T.result, lang)}:</span> {taskResult}
      </p>
    );
  }
  if (completed) {
    return (
      <p className="mt-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
        {pick(T.noResult, lang)}
      </p>
    );
  }
  return null;
}

export default function BriefingPanel({ call }: { call: CallDetail }) {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const [copied, setCopied] = useState(false);

  const briefing = call.briefing;
  const task = briefing?.task?.trim() ?? '';

  const copy = () => {
    void navigator.clipboard?.writeText(task);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <section className="mb-3 rounded-[10px] border border-[var(--line)] bg-[var(--paper)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ink)]">
          <ClipboardList className="h-3.5 w-3.5 text-[var(--text-4)]" />
          {pick(T.title, lang)}
        </h4>
        {briefing?.source && (
          <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', CHIP_TONE_CLASS.grey)}>
            {SOURCE_LABEL[briefing.source] ? pick(SOURCE_LABEL[briefing.source], lang) : briefing.source}
          </span>
        )}
        {task && (
          <button
            type="button"
            onClick={copy}
            className="ml-auto flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-4)] transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)]"
            title={pick(T.copy, lang)}
          >
            {copied ? <Check className="h-3 w-3 text-green-600" /> : <ClipboardCopy className="h-3 w-3" />}
            {copied ? pick(T.copied, lang) : pick(T.copy, lang)}
          </button>
        )}
      </div>

      {task ? (
        // Verbatim: the line breaks the user typed are the line breaks the
        // agent was given, so they are the line breaks shown here.
        <p className="mt-2 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-[var(--text-2)]">
          {task}
        </p>
      ) : (
        <p className="mt-2 text-[11.5px] text-[var(--text-5)]">{pick(T.none, lang)}</p>
      )}

      <AdherenceStrip call={call} lang={lang} />
    </section>
  );
}
