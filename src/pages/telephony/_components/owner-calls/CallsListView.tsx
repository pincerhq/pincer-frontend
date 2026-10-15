/**
 * /telephony/calls — the owner's call history (FE2 §1). Desktop table,
 * phone cards (DataTable's own fallback), URL-synced PII-free filters, live
 * section on top, CSV export of the current filter.
 */
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, CalendarCheck, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { MaskedNumber } from "@/components/voice/MaskedNumber";
import { purposePreview, useCallFilters, useOwnerCalls, type OwnerCall } from "@/lib/api/owner/calls";
import { formatCallTime, formatClock } from "@/lib/format";
import { useVoiceT } from "@/i18n/voice";
import { ROUTES } from "@/pages/telephony/_lib/routes";
import CallFiltersBar from "./CallFiltersBar";
import CsvExportButton from "./CsvExportButton";
import LiveCallsSection from "./LiveCallsSection";
import { IntentChip } from "./IntentChip";
import { ResultChip } from "./ResultChip";

export default function CallsListView() {
  const t = useVoiceT("voice-calls");
  const tc = useVoiceT("voice-common");
  const navigate = useNavigate();
  const [filters, setFilters, resetFilters] = useCallFilters();
  const { calls, total, languages, isLoading, isError, error, hasMore, loadMore, refetch } = useOwnerCalls(filters);

  const columns: DataTableColumn<OwnerCall>[] = [
    {
      key: "time",
      header: t("columns.time"),
      primary: false,
      cell: (c) => <span className="whitespace-nowrap text-sm text-[var(--text-2)]">{formatCallTime(c.started_at, t("today"))}</span>,
      sort: (a, b) => a.started_at.localeCompare(b.started_at),
    },
    {
      key: "contact",
      header: t("columns.contact"),
      primary: true,
      cell: (c) => (
        <span className="inline-flex items-center gap-2">
          {c.direction === "inbound" ? (
            <PhoneIncoming className="h-3.5 w-3.5 shrink-0 text-[var(--text-3)]" aria-label={t("direction.inbound")} />
          ) : (
            <PhoneOutgoing className="h-3.5 w-3.5 shrink-0 text-[var(--text-3)]" aria-label={t("direction.outbound")} />
          )}
          {c.contactName ? <span className="font-medium text-[var(--ink)]">{c.contactName}</span> : <MaskedNumber value={c.number} static />}
        </span>
      ),
      sort: (a, b) => (a.contactName ?? a.number).localeCompare(b.contactName ?? b.number),
    },
    {
      key: "result",
      header: t("columns.result"),
      cell: (c) => <ResultChip group={c.resultGroup} failureCode={c.failure_code} />,
      sort: (a, b) => a.resultGroup.localeCompare(b.resultGroup),
    },
    {
      key: "intent",
      header: t("columns.intent"),
      cell: (c) => (c.direction === "inbound" ? <IntentChip intent={c.intentKey} /> : <span className="text-xs text-[var(--text-2)]">{purposePreview(c)}</span>),
    },
    {
      key: "duration",
      header: t("columns.duration"),
      align: "right",
      cell: (c) => <span className="tabular-nums text-sm text-[var(--text-2)]">{formatClock(c.duration_seconds)}</span>,
      sort: (a, b) => a.duration_seconds - b.duration_seconds,
    },
    {
      key: "flags",
      header: "",
      hideOnMobile: true,
      cell: (c) => (
        <span className="inline-flex items-center gap-1.5">
          {c.appointment && <CalendarCheck className="h-4 w-4 text-green-700" aria-label={t("columns.appointment")} />}
          {c.needsAttention && <AlertCircle className="h-4 w-4 text-[var(--warn-fg)]" aria-label={t("columns.attention")} />}
        </span>
      ),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5 sm:px-6 md:px-8">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--ink)] sm:text-2xl">{t("title")}</h1>
          <div className="flex items-center gap-2">
            <CsvExportButton calls={calls} />
            <Link to={ROUTES.CALLS_OPS} className="text-xs text-[var(--text-3)] underline-offset-2 hover:underline">
              {t("opsView")}
            </Link>
          </div>
        </header>

        <LiveCallsSection />

        <CallFiltersBar filters={filters} languages={languages} onChange={setFilters} onReset={resetFilters} />

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 rounded-[10px]" />
            <Skeleton className="h-12 rounded-[10px]" />
            <Skeleton className="h-12 rounded-[10px]" />
          </div>
        ) : isError ? (
          <div role="alert" data-testid="list-error" className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-[color:color-mix(in_srgb,var(--bad-fg)_25%,transparent)] bg-[color:color-mix(in_srgb,var(--bad-fg)_6%,transparent)] px-3 py-2 text-sm text-[var(--bad-fg)]">
            <span>{error?.message ?? tc("errors.network")}</span>
            <button type="button" className="rounded-[8px] border border-current px-2 py-0.5 text-xs" onClick={() => void refetch()}>{tc("errors.retry")}</button>
          </div>
        ) : (
          <>
            <p className="text-xs text-[var(--text-3)]" aria-live="polite">
              {t("count", { count: calls.length })} {total !== calls.length ? t("ofTotal", { total }) : ""}
            </p>
            <DataTable
              rows={calls}
              columns={columns}
              rowKey={(c) => c.call_sid}
              labels={{ empty: t("empty"), sortBy: (col) => tc("table.sortBy", { column: col }) }}
              onRowClick={(c) => navigate(ROUTES.CALL(c.call_sid))}
              defaultSort={{ key: "time", direction: "desc" }}
              emptyState={
                <EmptyState
                  title={total === 0 ? t("empty") : t("emptyFiltered")}
                  action={
                    total > 0 ? (
                      <button type="button" onClick={resetFilters} className="text-sm underline underline-offset-2">
                        {t("resetFilters")}
                      </button>
                    ) : undefined
                  }
                />
              }
            />
            {hasMore && (
              <button type="button" onClick={loadMore} className="text-sm text-[var(--text-2)] underline underline-offset-2">
                {t("loadMore")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
