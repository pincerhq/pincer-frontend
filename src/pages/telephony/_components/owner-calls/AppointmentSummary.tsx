import { AlertTriangle, CalendarCheck, ExternalLink } from "lucide-react";
import type { AppointmentDetail } from "@/lib/api/voice";
import { formatDateTime } from "@/lib/format";
import { useVoiceT } from "@/i18n/voice";

const MAX_RETRIES = 3;

/** Termin tab (FE2 §2): status, slot in de-DE, calendar link, retry count, write-failed guidance. */
export default function AppointmentSummary({ appointment }: { appointment: AppointmentDetail | null | undefined }) {
  const t = useVoiceT("voice-calls");
  if (!appointment) return <p className="text-sm text-[var(--text-2)]">{t("appointment.none")}</p>;
  const status = String(appointment.status);
  const writeFailed = status === "calendar_write_failed" || (status === "failed" && Boolean(appointment.agreed_datetime));
  return (
    <div className="space-y-3">
      {writeFailed && (
        <div role="alert" className="flex gap-2 rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">{t("appointment.writeFailedTitle")}</p>
            <p className="text-xs">{t("appointment.writeFailedHint")}</p>
          </div>
        </div>
      )}
      <dl className="divide-y divide-[var(--line-soft)] text-sm">
        <div className="flex justify-between gap-3 py-1.5">
          <dt className="text-[var(--text-3)]">{t("appointment.status")}</dt>
          <dd className="text-[var(--ink)]">{t(`appointment.statuses.${status}`, { defaultValue: status })}</dd>
        </div>
        <div className="flex justify-between gap-3 py-1.5">
          <dt className="text-[var(--text-3)]">{t("appointment.slot")}</dt>
          <dd className="inline-flex items-center gap-1.5 text-[var(--ink)]">
            {appointment.agreed_datetime ? (
              <>
                <CalendarCheck className="h-4 w-4 text-green-700" aria-hidden="true" />
                {formatDateTime(appointment.agreed_datetime)}
                {appointment.duration_minutes ? <span className="text-[var(--text-3)]">· {t("appointment.duration", { minutes: appointment.duration_minutes })}</span> : null}
              </>
            ) : (
              <span className="text-[var(--text-2)]">{t("appointment.noSlot")}</span>
            )}
          </dd>
        </div>
        {appointment.retry_count > 0 && (
          <div className="flex justify-between gap-3 py-1.5">
            <dt className="text-[var(--text-3)]">{t("appointment.retry", { n: appointment.retry_count, max: MAX_RETRIES })}</dt>
            <dd />
          </div>
        )}
      </dl>
      {appointment.calendar_event_link && (
        <a href={appointment.calendar_event_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-[var(--brand)] underline-offset-2 hover:underline">
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          {t("appointment.calendarLink")}
        </a>
      )}
    </div>
  );
}
