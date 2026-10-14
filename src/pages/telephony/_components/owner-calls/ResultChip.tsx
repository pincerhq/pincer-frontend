import { cn } from "@/lib/utils";
import type { ResultGroup } from "@/lib/api/owner/calls";
import { useVoiceT } from "@/i18n/voice";

const TONE: Record<ResultGroup, string> = {
  booked: "border-green-200 bg-green-50 text-green-800",
  message: "border-[var(--brand-200)] bg-[var(--brand-100)] text-[var(--brand)]",
  handoff: "border-[var(--line)] bg-[var(--sand)] text-[var(--text-2)]",
  done: "border-green-200 bg-green-50 text-green-800",
  not_reached: "border-[var(--line)] bg-[var(--sand)] text-[var(--text-2)]",
  declined: "border-amber-200 bg-amber-50 text-amber-800",
  failed: "border-red-200 bg-red-50 text-red-800",
  in_progress: "border-green-200 bg-green-50 text-green-800",
};

/** One chip per call, owner vocabulary only (FE2 §1.1). Raw codes stay in the Details tab. */
export function ResultChip({ group, failureCode, className }: { group: ResultGroup; failureCode?: string | null; className?: string }) {
  const t = useVoiceT("voice-calls");
  const tip = group === "failed" ? (failureCode === "briefing_lost" ? t("failureTip.briefing_lost") : t("failureTip.generic")) : undefined;
  return (
    <span
      title={tip}
      data-result={group}
      className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium", TONE[group], className)}
    >
      {group === "in_progress" && (
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
        </span>
      )}
      {t(`result.${group}`)}
    </span>
  );
}
