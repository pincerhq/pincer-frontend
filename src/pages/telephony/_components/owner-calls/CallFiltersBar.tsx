import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RESULT_GROUPS, type CallFilters, type IntentKey, type Period } from "@/lib/api/owner/calls";
import { useVoiceT } from "@/i18n/voice";

const PERIODS: Period[] = ["today", "7d", "30d", "all"];
const INTENTS: IntentKey[] = ["appointment", "message", "question", "human", "after_hours", "unknown"];

function Select({ id, label, value, onChange, children }: { id: string; label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="text-[11px] text-[var(--text-3)]">
        {label}
      </Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-[10px] border border-[var(--line)] bg-[var(--paper)] px-2 text-sm text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      >
        {children}
      </select>
    </div>
  );
}

export default function CallFiltersBar({
  filters,
  languages,
  onChange,
  onReset,
}: {
  filters: CallFilters;
  languages: string[];
  onChange: (next: Partial<CallFilters>) => void;
  onReset: () => void;
}) {
  const t = useVoiceT("voice-calls");
  const dirty = JSON.stringify({ ...filters, q: "" }) !== JSON.stringify({ period: "7d", direction: "all", result: "all", intent: "all", hasAppointment: false, needsAttention: false, language: "", q: "" }) || filters.q !== "";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t("filters.period")}>
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={filters.period === p}
            onClick={() => onChange({ period: p })}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
              filters.period === p ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]" : "border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--sand)]",
            )}
          >
            {t(`filters.periods.${p}`)}
          </button>
        ))}
        <div className="relative ml-auto min-w-[12rem] flex-1 sm:flex-none">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-3)]" aria-hidden="true" />
          <Input
            type="search"
            value={filters.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder={t("filters.search")}
            aria-label={t("filters.search")}
            aria-describedby="calls-search-hint"
            className="h-9 rounded-[10px] pl-8"
          />
          <span id="calls-search-hint" className="sr-only">
            {t("filters.searchHint")}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
        <Select id="f-dir" label={t("filters.direction")} value={filters.direction} onChange={(v) => onChange({ direction: v as CallFilters["direction"] })}>
          <option value="all">{t("direction.all")}</option>
          <option value="inbound">{t("direction.inbound")}</option>
          <option value="outbound">{t("direction.outbound")}</option>
        </Select>
        <Select id="f-result" label={t("filters.result")} value={filters.result} onChange={(v) => onChange({ result: v as CallFilters["result"] })}>
          <option value="all">{t("filters.all")}</option>
          {RESULT_GROUPS.map((g) => (
            <option key={g} value={g}>
              {t(`result.${g}`)}
            </option>
          ))}
        </Select>
        <Select id="f-intent" label={t("filters.intent")} value={filters.intent} onChange={(v) => onChange({ intent: v as CallFilters["intent"] })}>
          <option value="all">{t("filters.all")}</option>
          {INTENTS.map((k) => (
            <option key={k} value={k}>
              {t(`intent.${k}`)}
            </option>
          ))}
        </Select>
        <Select id="f-lang" label={t("filters.language")} value={filters.language} onChange={(v) => onChange({ language: v })}>
          <option value="">{t("filters.all")}</option>
          {languages.map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-2 self-end pb-1.5">
          <Switch id="f-appt" checked={filters.hasAppointment} onCheckedChange={(v) => onChange({ hasAppointment: v })} />
          <Label htmlFor="f-appt" className="text-xs">
            {t("filters.hasAppointment")}
          </Label>
        </div>
        <div className="flex items-center gap-2 self-end pb-1.5">
          <Switch id="f-att" checked={filters.needsAttention} onCheckedChange={(v) => onChange({ needsAttention: v })} />
          <Label htmlFor="f-att" className="text-xs">
            {t("filters.needsAttention")}
          </Label>
        </div>
      </div>

      {dirty && (
        <button type="button" onClick={onReset} className="inline-flex items-center gap-1 text-xs text-[var(--text-3)] underline-offset-2 hover:underline">
          <X className="h-3 w-3" aria-hidden="true" />
          {t("resetFilters")}
        </button>
      )}
    </div>
  );
}
