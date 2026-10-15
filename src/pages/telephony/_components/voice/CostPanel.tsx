/**
 * What the call cost, broken into the four things that actually spend money:
 * the carrier minutes, speech in, speech out, and the tokens the conversation
 * burned.
 *
 * The dashboard has only ever shown the total. The breakdown is what tells
 * someone *why* a call was expensive — a two-minute call that cost more than a
 * ten-minute one is a token story, and the total alone hides it.
 */
import { useTranslation } from 'react-i18next';
import { Receipt } from 'lucide-react';
import { fmtCostUsd } from '@/pages/telephony/_lib/voiceMeta';
import type { CallCostBreakdown } from '@/lib/api/voice';

const T = {
  title: { en: 'Cost', de: 'Kosten' },
  carrier: { en: 'Carrier', de: 'Telefonie' },
  stt: { en: 'Speech in', de: 'Spracherkennung' },
  tts: { en: 'Speech out', de: 'Sprachausgabe' },
  llm: { en: 'Model', de: 'Modell' },
  total: { en: 'Total', de: 'Gesamt' },
  seconds: { en: 's of audio', de: 's Audio' },
  characters: { en: 'characters', de: 'Zeichen' },
  tokens: { en: 'in / out tokens', de: 'Tokens rein / raus' },
} as const;

const pick = (e: { en: string; de: string }, lang?: string) => (lang?.startsWith('de') ? e.de : e.en);

const num = (n: number | undefined, lang?: string) =>
  n == null ? null : n.toLocaleString(lang?.startsWith('de') ? 'de-DE' : 'en-US');

function Row({ label, usd, sub }: { label: string; usd: number | undefined; sub?: string | null }) {
  // A component with no charge and no usage is not part of this call's story.
  if (usd == null && !sub) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-[var(--line-soft)] py-1.5 first:border-t-0">
      <span className="min-w-0">
        <span className="text-[11.5px] text-[var(--text-3)]">{label}</span>
        {sub && <span className="ml-1.5 text-[10.5px] text-[var(--text-5)]">{sub}</span>}
      </span>
      <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-[var(--text-2)]">
        {usd == null ? '—' : fmtCostUsd(usd)}
      </span>
    </div>
  );
}

export default function CostPanel({ cost }: { cost: CallCostBreakdown | null | undefined }) {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  if (!cost) return null;

  const sttSub = cost.stt_seconds ? `${num(cost.stt_seconds, lang)} ${pick(T.seconds, lang)}` : null;
  const ttsSub = cost.tts_characters ? `${num(cost.tts_characters, lang)} ${pick(T.characters, lang)}` : null;
  const llmSub =
    cost.llm_input_tokens || cost.llm_output_tokens
      ? `${num(cost.llm_input_tokens ?? 0, lang)} / ${num(cost.llm_output_tokens ?? 0, lang)} ${pick(T.tokens, lang)}`
      : null;

  return (
    <section className="mb-3 rounded-[10px] border border-[var(--line)] bg-[var(--paper)] p-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ink)]">
        <Receipt className="h-3.5 w-3.5 text-[var(--text-4)]" />
        {pick(T.title, lang)}
        {cost.engine && (
          <span className="ml-auto font-mono text-[10px] font-normal text-[var(--text-5)]">
            {cost.engine}
          </span>
        )}
      </h4>

      <Row label={pick(T.carrier, lang)} usd={cost.twilio_usd} />
      <Row label={pick(T.stt, lang)} usd={cost.stt_usd} sub={sttSub} />
      <Row label={pick(T.tts, lang)} usd={cost.tts_usd} sub={ttsSub} />
      <Row label={pick(T.llm, lang)} usd={cost.llm_usd} sub={llmSub} />

      {cost.total_usd != null && (
        <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-[var(--line)] pt-2">
          <span className="text-[11.5px] font-semibold text-[var(--ink)]">{pick(T.total, lang)}</span>
          <span className="font-mono text-[12px] font-semibold tabular-nums text-[var(--ink)]">
            {fmtCostUsd(cost.total_usd)}
          </span>
        </div>
      )}
    </section>
  );
}
