/**
 * Persistent status banner (FE1 §2). One line, top of the content column:
 *   offline  › "Verbindung zum Server unterbrochen" (health poll 30 s, two failures)
 *   sip      › "SIP-Registrierung getrennt — Rufumleitung auf … aktivieren"
 *   inactive › "Nicht aktiv — Einrichtung abschließen" (link to the wizard)
 *   active   › "Empfangsdienst aktiv · +49 5223 …"
 * The number and SIP facts come from `status.telephony` (FE1 API ask) and
 * are simply absent until it lands.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHealth } from "@/lib/capabilities";
import { useVoiceStatus } from "@/lib/api/voice";
import { telephonyFacts } from "@/lib/api/owner/overview";
import { useVoiceT } from "@/i18n/voice";
import { ROUTES } from "@/pages/telephony/_lib/routes";

export type BannerState = "checking" | "offline" | "sip" | "inactive" | "active";

export function useBannerState(): { state: BannerState; number: string | null; failoverHint: string | null } {
  const health = useHealth();
  const status = useVoiceStatus();
  const failures = useRef(0);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (health.isError) {
      failures.current += 1;
      if (failures.current >= 2) setOffline(true);
    } else if (health.isSuccess) {
      failures.current = 0;
      setOffline(false);
    }
  }, [health.isError, health.isSuccess, health.dataUpdatedAt, health.errorUpdatedAt]);

  const facts = telephonyFacts(status.data);
  if (offline) return { state: "offline", number: facts.numberMasked, failoverHint: facts.failoverHint };
  if (!status.data) return { state: "checking", number: null, failoverHint: null };
  if (facts.sipRegistered === false) return { state: "sip", number: facts.numberMasked, failoverHint: facts.failoverHint };
  if (status.data.enabled === false || !status.data.voice_configured) return { state: "inactive", number: null, failoverHint: null };
  return { state: "active", number: facts.numberMasked, failoverHint: null };
}

export default function StatusBanner() {
  const t = useVoiceT("voice-nav");
  const { state, number, failoverHint } = useBannerState();

  const tone =
    state === "offline" || state === "sip"
      ? "border-[color:color-mix(in_srgb,var(--bad-fg)_25%,transparent)] bg-[color:color-mix(in_srgb,var(--bad-fg)_6%,transparent)] text-[var(--bad-fg)]"
      : state === "inactive"
        ? "border-[color:color-mix(in_srgb,var(--warn-fg)_25%,transparent)] bg-[var(--warn-bg)] text-[var(--warn-fg)]"
        : "border-[var(--line-soft)] bg-[var(--ok-bg)] text-[var(--ok-fg)]";

  const Icon = state === "offline" ? WifiOff : state === "active" ? CheckCircle2 : AlertTriangle;

  return (
    <div
      role="status"
      aria-live="polite"
      data-banner-state={state}
      className={cn("flex items-center gap-2 border-b px-4 py-1.5 text-xs font-medium sm:px-6", tone)}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {state === "checking" && <span>{t("banner.checking")}</span>}
      {state === "offline" && (
        <span>
          {t("banner.offline")} <span className="font-normal">{t("banner.offlineHint")}</span>
        </span>
      )}
      {state === "sip" && (
        <span>
          {t("banner.sip")} — {failoverHint ?? (number ? t("banner.sipHint", { number }) : t("banner.sipHintGeneric"))}
        </span>
      )}
      {state === "inactive" && (
        <span>{t("banner.inactive")}</span>
      )}
      {state === "active" && <span>{number ? t("banner.activeWithNumber", { number }) : t("banner.active")}</span>}
    </div>
  );
}
