import { useMemo, useState } from "react";
import { Copy, Info, Languages, Megaphone, PhoneForwarded, Search, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { parseTranscript, useTranscriptRevealAudited, type TranscriptEventKind } from "@/lib/api/owner/calls";
import type { TranscriptLine } from "@/lib/api/voice";
import { formatTime } from "@/lib/format";
import { useCan } from "@/stores/session";
import { useVoiceT } from "@/i18n/voice";

const EVENT_ICON: Record<TranscriptEventKind, typeof Info> = {
  briefing: Megaphone,
  language_switch: Languages,
  disclosure: Info,
  tool: Wrench,
  handoff: PhoneForwarded,
  system: Info,
};

/**
 * Verlauf tab (FE2 §2): speech lines with owner speaker labels, SYSTEM lines
 * as timeline events, numbers masked unless the owner reveals — and reveal
 * only exists once the backend audits it (`transcript_reveal_audited`).
 */
export default function TranscriptView({ lines, purged }: { lines: TranscriptLine[]; purged?: boolean }) {
  const t = useVoiceT("voice-calls");
  const canReveal = useCan("view_transcript_full");
  const audited = useTranscriptRevealAudited();
  const [masked, setMasked] = useState(true);
  const [query, setQuery] = useState("");
  const items = useMemo(() => parseTranscript(lines, masked), [lines, masked]);
  const q = query.trim().toLowerCase();
  const matches = q ? items.filter((i) => i.text.toLowerCase().includes(q)).length : 0;

  if (purged) return <p className="text-sm text-[var(--text-2)]">{t("transcript.purged")}</p>;
  if (lines.length === 0) return <p className="text-sm text-[var(--text-2)]">{t("transcript.empty")}</p>;

  const copyAll = async () => {
    const text = items.map((i) => (i.kind === "line" ? `${t(`transcript.speakers.${i.speaker}`)}: ${i.text}` : `— ${t(`transcript.events.${i.event}`)}: ${i.text}`)).join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-3)]" aria-hidden="true" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("transcript.search")} aria-label={t("transcript.search")} className="h-9 rounded-[10px] pl-8" />
        </div>
        {q && (
          <span className="text-xs text-[var(--text-3)]" aria-live="polite">
            {t("transcript.matches", { count: matches })}
          </span>
        )}
        {canReveal && audited && (
          <button type="button" onClick={() => setMasked((m) => !m)} aria-pressed={!masked} className="rounded-[10px] border border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--text-2)] hover:bg-[var(--sand)]" title={t("transcript.fullAudited")}>
            {masked ? t("transcript.showFull") : t("transcript.showMasked")}
          </button>
        )}
        <button type="button" onClick={copyAll} className="inline-flex items-center gap-1 rounded-[10px] border border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--text-2)] hover:bg-[var(--sand)]">
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          {t("transcript.copy")}
        </button>
      </div>
      {canReveal && !audited && <p className="text-xs text-[var(--text-3)]">{t("transcript.fullNote")}</p>}

      <ol className="space-y-2">
        {items.map((item, i) => {
          const hit = q && item.text.toLowerCase().includes(q);
          if (item.kind === "event") {
            const Icon = EVENT_ICON[item.event];
            return (
              <li key={i} className={cn("flex items-start gap-2 rounded-[10px] border border-dashed border-[var(--line)] px-3 py-1.5 text-xs text-[var(--text-2)]", hit && "bg-amber-50")}>
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-3)]" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="font-semibold">{t(`transcript.events.${item.event}`)}</span>
                  {item.text && <span className="ml-1 whitespace-pre-wrap">{item.text}</span>}
                </span>
                <time className="ml-auto shrink-0 tabular-nums text-[var(--text-3)]">{formatTime(item.timestamp)}</time>
              </li>
            );
          }
          const isAssistant = item.speaker === "assistant";
          return (
            <li key={i} className={cn("flex gap-2", isAssistant ? "" : "")}>
              <div className={cn("max-w-[85%] rounded-[12px] px-3 py-2 text-sm", isAssistant ? "bg-[var(--sand)] text-[var(--text-1)]" : "bg-[var(--brand-100)] text-[var(--ink)]", hit && "ring-2 ring-amber-300")}>
                <div className="mb-0.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
                  <span>{t(`transcript.speakers.${item.speaker}`)}</span>
                  <time className="font-normal normal-case tabular-nums">{formatTime(item.timestamp)}</time>
                </div>
                <p className="whitespace-pre-wrap">{item.text}</p>
                {item.undelivered && <p className="mt-1 text-[10px] text-amber-800">{t("transcript.undelivered")}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
