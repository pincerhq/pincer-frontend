import { PhoneOff } from "lucide-react";
import { useEndCall } from "@/lib/api/voice";
import { useCapabilities } from "@/lib/capabilities";
import { useVoiceT } from "@/i18n/voice";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Hangs up a live call after a confirmation (it ends a real conversation and
 * cannot be undone); shown only when the backend declares `call_controls`.
 */
export default function EndCallButton({ callSid }: { callSid: string }) {
  const t = useVoiceT("voice-calls");
  const declared = useCapabilities().isDeclared("call_controls");
  const end = useEndCall();
  if (!declared) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            disabled={end.isPending}
            className="inline-flex items-center gap-1 rounded-[8px] border border-[var(--line)] px-2 py-1 text-xs text-[var(--bad-fg)] hover:bg-[var(--sand)] disabled:opacity-60"
          >
            <PhoneOff className="h-3.5 w-3.5" aria-hidden="true" />
            {end.isPending ? t("live.ending") : end.isError ? t("live.endRetry") : t("live.end")}
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("live.endConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("live.endConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("live.endCancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => end.mutate(callSid)}>{t("live.end")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {end.isError && (
        <span role="alert" className="text-xs text-[var(--bad-fg)]">
          {t("live.endFailed", { reason: end.error.message })}
        </span>
      )}
    </span>
  );
}
