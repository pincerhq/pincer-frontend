import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { useActiveCalls, type ActiveCall } from "@/lib/api/voice";
import { formatClock } from "@/lib/format";
import { useVoiceT } from "@/i18n/voice";
import { MaskedNumber } from "@/components/voice/MaskedNumber";
import { ROUTES } from "@/pages/telephony/_lib/routes";
import { OverviewCard } from "./OverviewCard";

/** Seconds since `startedAt`, ticking once a second. */
function useTicking(startedAt: string | undefined, base: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const started = startedAt ? new Date(startedAt).getTime() : NaN;
  if (Number.isNaN(started)) return base;
  return Math.max(base, Math.round((now - started) / 1000));
}

function Row({ call, debug }: { call: ActiveCall; debug: boolean }) {
  const t = useVoiceT("voice-overview");
  const seconds = useTicking(call.started_at, call.duration_seconds ?? 0);
  const inbound = call.direction === "inbound";
  const Icon = inbound ? PhoneIncoming : PhoneOutgoing;
  const number = inbound ? call.caller_number : call.target_number;
  const purpose = call.purpose || call.briefing_task_preview || "";
  return (
    <li className="flex items-center gap-3 rounded-[10px] bg-[var(--sand)] px-3 py-2">
      <Icon className="h-4 w-4 shrink-0 text-[var(--ok-fg)]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[var(--text-3)]">{inbound ? t("now.inbound") : t("now.outbound")}</span>
          <MaskedNumber value={number} className="text-[var(--ink)]" />
          {debug && call.engine && <span className="rounded-full bg-[var(--sand-deep)] px-1.5 text-[10px] text-[var(--text-3)]">{call.engine}</span>}
        </div>
        <p className="truncate text-xs text-[var(--text-3)]">{purpose || t("now.unknownPurpose")}</p>
      </div>
      <span className="shrink-0 font-mono text-sm tabular-nums text-[var(--ink)]" aria-live="off">
        {formatClock(seconds)}
      </span>
    </li>
  );
}

export default function ActiveCallsCard() {
  const t = useVoiceT("voice-overview");
  const { data, isLoading, isError } = useActiveCalls();
  const [params] = useSearchParams();
  const debug = params.has("debug");
  // After a failed poll `data` is the last list; it must not pass for live calls.
  const calls = isError ? [] : (data ?? []);

  return (
    <OverviewCard
      title={t("now.title")}
      testId="card-now"
      action={
        <Link to={ROUTES.CALLS_LIVE} className="text-xs text-[var(--text-3)] underline-offset-2 hover:underline">
          {t("now.all")}
        </Link>
      }
    >
      {calls.length === 0 ? (
        <p className="text-sm text-[var(--text-3)]" aria-live="polite">
          {isLoading ? "" : isError ? t("now.unreachable") : t("now.empty")}
        </p>
      ) : (
        <ul className="space-y-2" aria-live="polite">
          {calls.map((c) => (
            <Row key={c.call_sid} call={c} debug={debug} />
          ))}
        </ul>
      )}
    </OverviewCard>
  );
}
