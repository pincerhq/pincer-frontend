import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, ChevronRight } from "lucide-react";
import { useAttentionItems, type AttentionItem } from "@/lib/api/owner/overview";
import { formatRelative } from "@/lib/format";
import { useVoiceT } from "@/i18n/voice";
import { MaskedNumber } from "@/components/voice/MaskedNumber";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/pages/telephony/_lib/routes";
import { ComputedBadge } from "./ComputedBadge";
import { OverviewCard } from "./OverviewCard";

/**
 * A row leads to the call it came from; a message with no call leads to the
 * inbox. (The standalone Aufmerksamkeit queue is gone — `/api/voice/attention`
 * is not served, and this card is computed from calls and messages anyway.)
 */
function targetFor(item: AttentionItem): string {
  if (item.callSid) return ROUTES.CALL(item.callSid);
  return ROUTES.MESSAGES;
}

export default function AttentionCard() {
  const t = useVoiceT("voice-overview");
  const navigate = useNavigate();
  const { items, isLoading } = useAttentionItems(5);

  return (
    <OverviewCard
      title={t("attention.title")}
      badge={<ComputedBadge />}
      testId="card-attention"
      action={
        <Link to={ROUTES.MESSAGES} className="text-xs text-[var(--text-3)] underline-offset-2 hover:underline">
          {t("attention.all")}
        </Link>
      }
    >
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 rounded-[10px]" />
          <Skeleton className="h-10 rounded-[10px]" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--text-3)]">{t("attention.empty")}</p>
      ) : (
        <ul className="divide-y divide-[var(--line-soft)]">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => navigate(targetFor(item))}
                className="flex w-full items-center gap-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                <AlertCircle
                  className={item.kind === "urgent_message" || item.kind === "handoff_failed" ? "h-4 w-4 shrink-0 text-[var(--bad-fg)]" : "h-4 w-4 shrink-0 text-[var(--warn-fg)]"}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--ink)]">{t(`attention.kinds.${item.kind}`)}</p>
                  <p className="truncate text-xs text-[var(--text-3)]">
                    {item.summary || <MaskedNumber value={item.number} static />}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-[var(--text-3)]">{formatRelative(item.at)}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-3)]" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </OverviewCard>
  );
}
