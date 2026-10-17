import { Headphones, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { useActiveCalls } from "@/lib/api/voice";
import { useSession, useCan } from "@/stores/session";
import { useVoiceT } from "@/i18n/voice";
import { MaskedNumber } from "@/components/voice/MaskedNumber";
import EndCallButton from "@/components/voice/EndCallButton";

/**
 * Active calls above the history (FE2 §1.3). Listen-in is deferred in the
 * owner app (decision §11): where the backend reports `listen_available`
 * and the role allows, the control links to the operations console's player
 * and wears a badge naming the sprint that would replace it.
 */
export default function LiveCallsSection() {
  const t = useVoiceT("voice-calls");
  const to = useVoiceT("voice-overview");
  const { data } = useActiveCalls();
  const apiUrl = useSession((s) => s.apiUrl);
  const canListen = useCan("view_transcript_full");
  const calls = data ?? [];
  if (calls.length === 0) return null;
  return (
    <section aria-labelledby="live-calls-title" className="rounded-[14px] border border-green-200 bg-green-50/40 p-3 sm:p-4">
      <h2 id="live-calls-title" className="mb-2 text-sm font-semibold text-[var(--ink)]">
        {t("live.title")}
      </h2>
      <ul className="space-y-2">
        {calls.map((c) => {
          const inbound = c.direction === "inbound";
          const Icon = inbound ? PhoneIncoming : PhoneOutgoing;
          return (
            <li key={c.call_sid} className="flex flex-wrap items-center gap-3 rounded-[10px] bg-[var(--paper)] px-3 py-2">
              <Icon className="h-4 w-4 shrink-0 text-[var(--ok-fg)]" aria-hidden="true" />
              <span className="text-xs text-[var(--text-3)]">{inbound ? to("now.inbound") : to("now.outbound")}</span>
              <MaskedNumber value={inbound ? c.caller_number : c.target_number} />
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-2)]">{c.purpose || c.briefing_task_preview || to("now.unknownPurpose")}</span>
              {c.listen_available && canListen && apiUrl && (
                <span className="flex items-center gap-1.5" title={t("live.listenHint")}>
                  <a
                    href={`${apiUrl}/voiceops`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-[8px] border border-[var(--line)] px-2 py-1 text-xs text-[var(--text-2)] hover:bg-[var(--sand)]"
                  >
                    <Headphones className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("live.listen")}
                  </a>
                </span>
              )}
              <EndCallButton callSid={c.call_sid} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
