import { useHangUpFailures } from "@/lib/api/voice";
import { useVoiceT } from "@/i18n/voice";
import { MaskedNumber } from "@/components/voice/MaskedNumber";
import EndCallButton from "@/components/voice/EndCallButton";

/**
 * Hang-ups Twilio rejected, for the live lists. On a 502 the backend drops
 * the call from /active, so its row (and the End call button with the error)
 * is gone on the next poll while the caller may still be on the line (#27).
 * This keeps the error and the retry on screen, apart from the rows.
 * `liveSids`: calls whose own row still shows them.
 */
export default function FailedHangUps({ liveSids = [] }: { liveSids?: string[] }) {
  const t = useVoiceT("voice-calls");
  const failures = useHangUpFailures().filter((f) => !liveSids.includes(f.callSid));
  if (failures.length === 0) return null;
  return (
    <section
      aria-labelledby="failed-hang-ups-title"
      data-testid="failed-hang-ups"
      className="rounded-[14px] border border-[var(--line)] bg-[var(--paper)] p-3 sm:p-4"
    >
      <h2 id="failed-hang-ups-title" className="mb-2 text-sm font-semibold text-[var(--bad-fg)]">
        {t("live.hangUpFailedTitle")}
      </h2>
      <ul className="space-y-2">
        {failures.map(({ callSid, call }) => {
          const number = call ? (call.direction === "inbound" ? call.caller_number : call.target_number) : "";
          return (
            <li key={callSid} className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 truncate text-sm text-[var(--text-2)]">
                {call?.target_name || (number ? <MaskedNumber value={number} /> : t("live.hangUpFailedUnknown", { sid: callSid }))}
              </span>
              <EndCallButton callSid={callSid} live={false} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
