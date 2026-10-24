/**
 * Übersicht data (FE1 §3, §5). Query keys and cadences follow the spec:
 *   ['health'] 30 s · ['voice','status'] · ['voice','active'] (existing hooks)
 *   ['voice','calls',{needs_attention:1}] 30 s · ['voice','stats','today'] 60 s
 *
 * Two of these are **computed in the browser** until the backend serves them
 * (`GET /api/voice/stats?period=today`, `needs_attention=1` — FE1 API asks);
 * the cards wear the "berechnet im Browser" badge for exactly that reason.
 * Everything else here reads an endpoint and degrades to "not available"
 * on 401/403/404 rather than to a zero.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api/client";
import {
  useCallHistoryAll,
  useMessages,
  useReceptionistProfile,
  useVoiceConnected,
  type BusinessProfile,
  type CallSummary,
  type InboundMessage,
  type Weekday,
} from "@/lib/api/voice";

// ── helpers ──────────────────────────────────────────────────────────────

const WEEKDAY_BY_INDEX: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Parts of an instant in a zone, via Intl (no library, DST-correct). */
function zonedParts(iso: string, timeZone: string | undefined) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    });
    const map: Record<string, string> = {};
    for (const part of fmt.formatToParts(d)) map[part.type] = part.value;
    const weekdayIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(map.weekday);
    return {
      dateKey: `${map.year}-${map.month}-${map.day}`,
      minutes: Number(map.hour === "24" ? 0 : map.hour) * 60 + Number(map.minute),
      weekday: WEEKDAY_BY_INDEX[weekdayIdx >= 0 ? weekdayIdx : d.getDay()],
    };
  } catch {
    return null;
  }
}

function todayKey(timeZone: string | undefined): string {
  return zonedParts(new Date().toISOString(), timeZone)?.dateKey ?? "";
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Outside the profile's hours for that weekday; unknown hours → not after-hours. */
export function isAfterHours(iso: string, profile: BusinessProfile | null): boolean {
  if (!profile) return false;
  const parts = zonedParts(iso, profile.timezone);
  if (!parts) return false;
  const ranges = profile.hours[parts.weekday];
  if (!ranges || ranges.length === 0) return true;
  return !ranges.some((r) => {
    // The profile API says {open, close}; older drafts said {from, to}.
    const raw = r as { open?: string; close?: string; from?: string; to?: string };
    const from = toMinutes(raw.open ?? raw.from ?? "00:00");
    const to = toMinutes(raw.close ?? raw.to ?? "24:00");
    return parts.minutes >= from && parts.minutes < to;
  });
}

const MISSED_STATUSES = new Set(["no-answer", "busy", "failed", "canceled", "cancelled"]);
const BOOKED = new Set(["calendar_created", "invitations_sent"]);
const HANDOFF_FAILURES = /transfer|handoff|forward/i;

// ── Heute ────────────────────────────────────────────────────────────────

export interface TodayStats {
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  afterHours: number;
  bookings: number;
  messages: number;
  total: number;
}

export function computeTodayStats(
  calls: CallSummary[],
  messages: InboundMessage[],
  profile: BusinessProfile | null,
  now = new Date(),
): TodayStats {
  const tz = profile?.timezone;
  const key = zonedParts(now.toISOString(), tz)?.dateKey ?? "";
  const today = calls.filter((c) => zonedParts(c.started_at, tz)?.dateKey === key);
  const stats: TodayStats = { inbound: 0, outbound: 0, answered: 0, missed: 0, afterHours: 0, bookings: 0, messages: 0, total: today.length };
  for (const c of today) {
    if (c.direction === "inbound") stats.inbound++;
    else stats.outbound++;
    const missed = MISSED_STATUSES.has(c.status) || (c.duration_seconds === 0 && c.status !== "active");
    if (missed) stats.missed++;
    else stats.answered++;
    if (c.inbound_intent === "after_hours" || (c.direction === "inbound" && isAfterHours(c.started_at, profile))) stats.afterHours++;
    if (c.appointment && BOOKED.has(String(c.appointment.status))) stats.bookings++;
  }
  stats.messages = messages.filter((m) => zonedParts(m.created_at, tz)?.dateKey === key).length;
  return stats;
}

export function useTodayStats() {
  const history = useCallHistoryAll();
  const messages = useMessages({ limit: 100 });
  const profile = useReceptionistProfile();
  const businessProfile = profile.data && profile.data.enabled ? (profile.data as BusinessProfile) : null;
  const stats = useMemo(
    () => computeTodayStats(history.calls ?? [], messages.data?.messages ?? [], businessProfile),
    [history.calls, messages.data?.messages, businessProfile],
  );
  return {
    stats,
    isLoading: history.isLoading || messages.isLoading,
    isError: history.isError,
    error: history.error,
    timezone: businessProfile?.timezone,
  };
}

// ── Braucht Sie ──────────────────────────────────────────────────────────

export type AttentionKind = "message" | "urgent_message" | "callback" | "handoff_failed" | "unanswered" | "human";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  /** The caller's number — masked by the surface, never here. */
  number: string;
  summary: string;
  at: string;
  callSid: string | null;
  messageId: string | null;
}

export function computeAttention(calls: CallSummary[], messages: InboundMessage[], limit = 5): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const m of messages) {
    if (m.read_at) continue;
    // A message whose intent was "call me back" is a callback request; the
    // inbox normaliser already folded the wire's urgent flag into `urgency`.
    // The wire (contract: `urgent`, `callback_number`) and the hand-written
    // inbox type (`urgency`, `caller_number`) disagree — see BACKEND-FE1 asks §7;
    // read both so the card is right against either.
    const wire = m as unknown as { urgent?: boolean; callback_number?: string | null };
    const urgent = m.urgency === "urgent" || wire.urgent === true;
    const callback = m.call?.inbound_intent === "human" || /r[üu]ckruf|call.?back/i.test(m.matter);
    items.push({
      id: `m-${m.id}`,
      kind: urgent ? "urgent_message" : callback ? "callback" : "message",
      number: m.caller_number ?? wire.callback_number ?? "",
      summary: m.matter,
      at: m.created_at,
      callSid: m.call_sid || null,
      messageId: m.id,
    });
  }
  const seen = new Set(items.map((i) => i.callSid).filter(Boolean));
  for (const c of calls) {
    if (c.direction !== "inbound" || seen.has(c.call_sid)) continue;
    let kind: AttentionKind | null = null;
    if (c.failure_code && HANDOFF_FAILURES.test(c.failure_code)) kind = "handoff_failed";
    else if (c.inbound_intent === "human" && MISSED_STATUSES.has(c.status)) kind = "human";
    else if (c.outcome?.outcome === "unanswered") kind = "unanswered";
    if (!kind) continue;
    items.push({
      id: `c-${c.call_sid}`,
      kind,
      number: c.from_number,
      summary: c.failure_description || c.outcome?.task_result || c.thread_subject || "",
      at: c.started_at,
      callSid: c.call_sid,
      messageId: null,
    });
  }
  const weight: Record<AttentionKind, number> = { urgent_message: 0, handoff_failed: 1, callback: 2, human: 3, message: 4, unanswered: 5 };
  items.sort((a, b) => weight[a.kind] - weight[b.kind] || b.at.localeCompare(a.at));
  return items.slice(0, limit);
}

export function useAttentionItems(limit = 5) {
  const history = useCallHistoryAll(400);
  const messages = useMessages({ unread: true, limit: 50 });
  const items = useMemo(
    () => computeAttention(history.calls ?? [], messages.data?.messages ?? [], limit),
    [history.calls, messages.data?.messages, limit],
  );
  return { items, isLoading: history.isLoading || messages.isLoading, isError: history.isError };
}

// ── Status card sources ──────────────────────────────────────────────────

export type ResidencyMode = "eu_verified" | "eu_native" | "on_prem" | "unknown";

export interface ResidencyManifest {
  mode?: string;
  ok?: boolean;
  violations?: unknown[];
}

function isNotExposed(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403 || err.status === 404);
}

/** Wraps a query so 401/403/404 become `null` (not exposed to owners) instead of an error. */
async function optional<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (isNotExposed(err)) return null;
    throw err;
  }
}

export function useResidency() {
  const connected = useVoiceConnected();
  return useQuery<ResidencyManifest | null, ApiError>({
    queryKey: ["voice", "residency"],
    queryFn: () => optional(() => api.get<ResidencyManifest>("/api/voice/residency")),
    enabled: connected,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function residencyMode(manifest: ResidencyManifest | null | undefined): ResidencyMode {
  const m = manifest?.mode;
  return m === "eu_verified" || m === "eu_native" || m === "on_prem" ? m : "unknown";
}

export interface DoctorReport {
  score?: number;
  passed?: boolean;
  warnings?: number;
  critical?: number;
  checks?: Array<{ name: string; status: string; message: string }>;
}

export function useDoctorSummary() {
  const connected = useVoiceConnected();
  return useQuery<DoctorReport | null, ApiError>({
    queryKey: ["doctor"],
    queryFn: () => optional(() => api.get<DoctorReport>("/api/doctor")),
    enabled: connected,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  });
}

/** Warnings + critical findings; null when the report is not exposed. */
export function doctorHints(report: DoctorReport | null | undefined): number | null {
  if (!report) return null;
  return (report.warnings ?? 0) + (report.critical ?? 0);
}

export interface CostsToday {
  date?: string;
  total_usd?: number;
  request_count?: number;
  budget?: { daily_limit?: number; spent_today?: number; spent_pct?: number; remaining?: number };
}

export function useCostsToday(enabledByRole: boolean) {
  const connected = useVoiceConnected();
  return useQuery<CostsToday | null, ApiError>({
    queryKey: ["costs", "today"],
    queryFn: () => optional(() => api.get<CostsToday>("/api/costs/today")),
    enabled: connected && enabledByRole,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
}

export interface IntegrationEntry {
  slug?: string;
  name?: string;
  active?: boolean;
  tools?: unknown[];
  source?: string;
}

const CALENDAR_INTEGRATIONS = /google|microsoft|ms365|outlook|calendar/i;

export function useCalendarConnection() {
  const connected = useVoiceConnected();
  const q = useQuery<{ integrations: IntegrationEntry[] } | null, ApiError>({
    queryKey: ["integrations"],
    queryFn: () => optional(() => api.get<{ integrations: IntegrationEntry[] }>("/api/integrations")),
    enabled: connected,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const entry = q.data?.integrations?.find((i) => i.active && CALENDAR_INTEGRATIONS.test(`${i.slug ?? ""} ${i.name ?? ""}`)) ?? null;
  return { ...q, calendar: entry, isExposed: q.data !== null && q.data !== undefined };
}

/**
 * Telephony facts for the status card and banner. `telephony` on VoiceStatus
 * is an FE1 API ask (B1/B3); until it lands the mode is inferred from what
 * the status already says and the number is unknown.
 */
export interface TelephonyFacts {
  mode: "forwarding" | "sip" | "twilio" | "unknown";
  numberMasked: string | null;
  sipRegistered: boolean | null;
  failoverHint: string | null;
}

export function telephonyFacts(status: unknown): TelephonyFacts {
  const t = ((status as { telephony?: unknown } | null | undefined)?.telephony ?? null) as Partial<{
    mode: string;
    number_masked: string;
    sip_registered: boolean;
    failover_hint: string;
  }> | null;
  const mode = t?.mode === "forwarding" || t?.mode === "sip" || t?.mode === "twilio" ? t.mode : "unknown";
  return {
    mode,
    numberMasked: t?.number_masked ?? null,
    sipRegistered: typeof t?.sip_registered === "boolean" ? t.sip_registered : null,
    failoverHint: t?.failover_hint ?? null,
  };
}
