/**
 * Owner call history and detail (FE2 §1, §2, §6).
 *
 * The backend's list endpoint filters by direction/status/thread only, so the
 * owner filters run over the loaded history (≤ 1 000 calls, paged) — the
 * "API asks" in docs/app/calls.md name the server-side filters that replace
 * this. Everything an owner sees is translated from backend states into
 * owner vocabulary here: one `ResultGroup` per call, one `IntentKey`, names
 * from the contact list, masked numbers everywhere.
 *
 * Nothing personal goes into the URL (Block I rule 5): `serializeFilters`
 * writes period/direction/result/intent/flags/language and a *name* query;
 * a query that looks like a phone number stays in memory and is matched
 * exactly after normalisation.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  useCallHistoryAll,
  useContacts,
  useVoiceStatus,
  type CallDetail,
  type CallSummary,
  type Contact,
  type TranscriptLine,
} from "@/lib/api/voice";
import { parseBriefingLine, parseLanguageSwitch } from "@/pages/telephony/_lib/voiceMeta";
import { computeAttention, useAttentionItems } from "./overview";

// ── Owner vocabulary ─────────────────────────────────────────────────────

export type ResultGroup =
  | "booked"
  | "message"
  | "handoff"
  | "done"
  | "not_reached"
  | "declined"
  | "failed"
  | "in_progress";

export const RESULT_GROUPS: ResultGroup[] = ["booked", "message", "handoff", "done", "not_reached", "declined", "failed", "in_progress"];

const LIVE_STATUSES = new Set(["active", "in-progress", "in_progress", "ringing", "queued", "initiated", "answered"]);
const NOT_REACHED = new Set(["no-answer", "no_answer", "busy", "voicemail", "canceled", "cancelled"]);
const BOOKED = new Set(["calendar_created", "invitations_sent", "confirmed", "booked"]);

/**
 * Every backend state → exactly one chip (FE2 §1.1). Order matters: a live
 * call is live whatever else it carries; a failure code beats an outcome;
 * bookings and messages beat the plain "done".
 */
export function resultGroupOf(call: Pick<CallSummary, "status" | "failure_code" | "inbound_intent" | "direction"> & {
  appointment?: { status?: string | null } | null;
  outcome?: { outcome?: string | null } | null;
}): ResultGroup {
  const status = (call.status ?? "").toLowerCase();
  if (LIVE_STATUSES.has(status)) return "in_progress";
  if (call.failure_code) return "failed";
  const outcome = (call.outcome?.outcome ?? "").toLowerCase();
  if (outcome === "declined" || outcome === "rejected") return "declined";
  if (NOT_REACHED.has(status) || NOT_REACHED.has(outcome)) return "not_reached";
  if (status === "failed") return "failed";
  if (call.appointment?.status && BOOKED.has(String(call.appointment.status))) return "booked";
  if (call.inbound_intent === "message" || outcome === "message_taken") return "message";
  if (call.inbound_intent === "human" || outcome === "transferred" || outcome === "handoff") return "handoff";
  return "done";
}

export type IntentKey = "appointment" | "message" | "question" | "human" | "after_hours" | "unknown";

export function intentKeyOf(call: Pick<CallSummary, "inbound_intent">): IntentKey {
  const raw = (call.inbound_intent ?? "").toLowerCase();
  if (raw === "appointment" || raw === "message" || raw === "question" || raw === "human" || raw === "after_hours") return raw;
  return "unknown";
}

/** Outbound rows show the briefing's first 60 characters instead of an intent. */
export function purposePreview(call: CallSummary & { briefing?: { task?: string } | null }, max = 60): string {
  const task = call.briefing?.task ?? call.thread_subject ?? "";
  if (!task) return "";
  return task.length > max ? `${task.slice(0, max - 1)}…` : task;
}

// ── Contacts ─────────────────────────────────────────────────────────────

export function normalizeNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  // 0049… and 0… → 49…: enough for matching, never shown.
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return `49${digits.slice(1)}`;
  return digits;
}

export function contactIndex(contacts: Contact[] | undefined): Map<string, Contact> {
  const map = new Map<string, Contact>();
  for (const c of contacts ?? []) {
    const key = normalizeNumber(c.phone_number);
    if (key) map.set(key, c);
  }
  return map;
}

export function counterpartNumber(call: Pick<CallSummary, "direction" | "from_number" | "to_number">): string {
  return call.direction === "outbound" ? call.to_number : call.from_number;
}

export function contactNameFor(call: Pick<CallSummary, "direction" | "from_number" | "to_number">, index: Map<string, Contact>): string | null {
  return index.get(normalizeNumber(counterpartNumber(call)))?.name ?? null;
}

// ── Filters ──────────────────────────────────────────────────────────────

export type Period = "today" | "7d" | "30d" | "all";

export interface CallFilters {
  period: Period;
  direction: "all" | "inbound" | "outbound";
  result: ResultGroup | "all";
  intent: IntentKey | "all";
  hasAppointment: boolean;
  needsAttention: boolean;
  language: string;
  /** Name query (URL) — or a number query (memory only). */
  q: string;
}

export const DEFAULT_FILTERS: CallFilters = {
  period: "7d",
  direction: "all",
  result: "all",
  intent: "all",
  hasAppointment: false,
  needsAttention: false,
  language: "",
  q: "",
};

export function looksLikeNumber(q: string): boolean {
  return /^[+\d][\d\s\-/()]{3,}$/.test(q.trim());
}

export function parseFilters(params: URLSearchParams): CallFilters {
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const v = params.get(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  };
  return {
    period: pick("period", ["today", "7d", "30d", "all"] as const, DEFAULT_FILTERS.period),
    direction: pick("dir", ["all", "inbound", "outbound"] as const, "all"),
    result: pick("result", ["all", ...RESULT_GROUPS] as const, "all"),
    intent: pick("intent", ["all", "appointment", "message", "question", "human", "after_hours", "unknown"] as const, "all"),
    hasAppointment: params.get("appt") === "1",
    needsAttention: params.get("attention") === "1",
    language: (params.get("lang") ?? "").slice(0, 8),
    q: looksLikeNumber(params.get("q") ?? "") ? "" : (params.get("q") ?? "").slice(0, 80),
  };
}

/** Never a number in the URL: a numeric query is dropped from the serialisation. */
export function serializeFilters(f: CallFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.period !== DEFAULT_FILTERS.period) p.set("period", f.period);
  if (f.direction !== "all") p.set("dir", f.direction);
  if (f.result !== "all") p.set("result", f.result);
  if (f.intent !== "all") p.set("intent", f.intent);
  if (f.hasAppointment) p.set("appt", "1");
  if (f.needsAttention) p.set("attention", "1");
  if (f.language) p.set("lang", f.language);
  if (f.q && !looksLikeNumber(f.q)) p.set("q", f.q);
  return p;
}

function periodStart(period: Period, now: Date): number {
  const d = new Date(now);
  if (period === "today") {
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (period === "7d") return now.getTime() - 7 * 86_400_000;
  if (period === "30d") return now.getTime() - 30 * 86_400_000;
  return 0;
}

export interface OwnerCall extends CallSummary {
  resultGroup: ResultGroup;
  intentKey: IntentKey;
  contactName: string | null;
  number: string;
  needsAttention: boolean;
}

export function decorateCalls(calls: CallSummary[], contacts: Contact[] | undefined, attentionSids: Set<string>): OwnerCall[] {
  const index = contactIndex(contacts);
  return calls.map((c) => ({
    ...c,
    resultGroup: resultGroupOf(c),
    intentKey: intentKeyOf(c),
    contactName: contactNameFor(c, index),
    number: counterpartNumber(c),
    needsAttention: attentionSids.has(c.call_sid),
  }));
}

export function applyFilters(calls: OwnerCall[], f: CallFilters, now = new Date()): OwnerCall[] {
  const start = periodStart(f.period, now);
  const q = f.q.trim().toLowerCase();
  const numberQuery = looksLikeNumber(q) ? normalizeNumber(q) : "";
  return calls.filter((c) => {
    if (start && new Date(c.started_at).getTime() < start) return false;
    if (f.direction !== "all" && c.direction !== f.direction) return false;
    if (f.result !== "all" && c.resultGroup !== f.result) return false;
    if (f.intent !== "all" && c.intentKey !== f.intent) return false;
    if (f.hasAppointment && !c.appointment) return false;
    if (f.needsAttention && !c.needsAttention) return false;
    if (f.language && (c.language ?? "").toLowerCase().slice(0, 2) !== f.language.toLowerCase().slice(0, 2)) return false;
    if (q) {
      if (numberQuery) return normalizeNumber(c.number) === numberQuery;
      return (c.contactName ?? "").toLowerCase().includes(q);
    }
    return true;
  });
}

/** URL-synced filters. `setFilters` writes only the PII-free serialisation. */
export function useCallFilters(): [CallFilters, (next: Partial<CallFilters>) => void, () => void] {
  const [params, setParams] = useSearchParams();
  const [numberQuery, setNumberQuery] = useState("");
  const filters = useMemo(() => {
    const f = parseFilters(params);
    return numberQuery ? { ...f, q: numberQuery } : f;
  }, [params, numberQuery]);
  const set = useCallback(
    (next: Partial<CallFilters>) => {
      const merged = { ...filters, ...next };
      if ("q" in next) setNumberQuery(looksLikeNumber(merged.q) ? merged.q : "");
      const serialized = serializeFilters(merged);
      // Keep unrelated params (e.g. ?call=) intact.
      for (const [k, v] of params.entries()) if (!["period", "dir", "result", "intent", "appt", "attention", "lang", "q"].includes(k)) serialized.set(k, v);
      setParams(serialized, { replace: true });
    },
    [filters, params, setParams],
  );
  const reset = useCallback(() => {
    setNumberQuery("");
    setParams(new URLSearchParams(), { replace: true });
  }, [setParams]);
  return [filters, set, reset];
}

export function useOwnerCalls(filters: CallFilters) {
  const history = useCallHistoryAll();
  const contacts = useContacts();
  const attention = useAttentionItems(999);
  const attentionSids = useMemo(() => new Set(attention.items.map((i) => i.callSid).filter((s): s is string => Boolean(s))), [attention.items]);
  const all = useMemo(() => decorateCalls(history.calls ?? [], contacts.data, attentionSids), [history.calls, contacts.data, attentionSids]);
  const filtered = useMemo(() => applyFilters(all, filters), [all, filters]);
  const languages = useMemo(() => Array.from(new Set(all.map((c) => (c.language ?? "").slice(0, 2)).filter(Boolean))).sort(), [all]);
  return {
    calls: filtered,
    total: all.length,
    languages,
    isLoading: history.isLoading,
    isError: history.isError,
    error: history.error,
    hasMore: history.cappedAt !== null,
    loadMore: history.loadMore,
    refetch: history.refetch,
  };
}

// ── Handled state (local until G2) ───────────────────────────────────────

const HANDLED_KEY = "voice.handled";

/** sid → ISO timestamp of the local "Erledigt" (the old array format is migrated on read). */
function readHandled(): Map<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(HANDLED_KEY) ?? "{}") as string[] | Record<string, string>;
    if (Array.isArray(raw)) return new Map(raw.map((sid) => [sid, ""]));
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

function writeHandled(map: Map<string, string>) {
  try {
    localStorage.setItem(HANDLED_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    /* ignore */
  }
}

/**
 * "Als erledigt markieren" for calls. There is no server-side `handled`
 * flag yet (G2 / FE8 API ask), so the state lives in this browser and the
 * button wears a badge. Messages use the real `POST /messages/{id}/read`.
 * FE8 keeps the timestamp so the time-to-callback KPI can be estimated.
 */
export function useHandledCalls() {
  const [handled, setHandled] = useState<Map<string, string>>(readHandled);
  useEffect(() => {
    const onStorage = () => setHandled(readHandled());
    window.addEventListener("storage", onStorage);
    window.addEventListener("voice-handled", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("voice-handled", onStorage);
    };
  }, []);
  const set = useCallback((sid: string, on: boolean) => {
    setHandled((prev) => {
      const next = new Map(prev);
      if (on) next.set(sid, new Date().toISOString());
      else next.delete(sid);
      writeHandled(next);
      window.dispatchEvent(new Event("voice-handled"));
      return next;
    });
  }, []);
  const toggle = useCallback((sid: string) => set(sid, !readHandled().has(sid)), [set]);
  return { handled, isHandled: (sid: string) => handled.has(sid), handledAt: (sid: string) => handled.get(sid) ?? null, toggle, set };
}

// ── Transcript ───────────────────────────────────────────────────────────

export type TranscriptSpeaker = "caller" | "assistant" | "system";

export type TranscriptEventKind = "briefing" | "language_switch" | "disclosure" | "tool" | "handoff" | "system";

export type TranscriptItem =
  | { kind: "line"; speaker: TranscriptSpeaker; text: string; timestamp?: string; undelivered: boolean }
  | { kind: "event"; event: TranscriptEventKind; text: string; timestamp?: string };

const PHONE_RE = /(\+?\d[\d\s\-/().]{6,}\d)/g;

/** Hide anything that reads like a phone number; names stay. */
export function maskTranscriptText(text: string): string {
  return text.replace(PHONE_RE, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 7) return m;
    return `${m.trim().startsWith("+") ? "+" : ""}${digits.slice(0, 2)} ••• ${digits.slice(-2)}`;
  });
}

/** SYSTEM lines become timeline events; speech becomes lines with owner speaker labels. */
export function parseTranscript(lines: TranscriptLine[], masked: boolean): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  for (const line of lines) {
    const text = masked ? maskTranscriptText(line.text) : line.text;
    if (line.speaker === "system") {
      const briefed = parseBriefingLine(line);
      if (briefed !== null) {
        out.push({ kind: "event", event: "briefing", text: masked ? maskTranscriptText(briefed) : briefed, timestamp: line.timestamp });
        continue;
      }
      const sw = parseLanguageSwitch(line);
      if (sw) {
        out.push({ kind: "event", event: "language_switch", text, timestamp: line.timestamp });
        continue;
      }
      const lower = line.text.toLowerCase();
      const event: TranscriptEventKind = /disclos|hinweis|announce/.test(lower)
        ? "disclosure"
        : /transfer|handoff|weiterleit|forward/.test(lower)
          ? "handoff"
          : /\[tool|tool:|werkzeug|calendar|kalender|lookup/.test(lower)
            ? "tool"
            : "system";
      out.push({ kind: "event", event, text: text.replace(/^\[[A-Z_ ]+\]\s*/, ""), timestamp: line.timestamp });
      continue;
    }
    const speaker: TranscriptSpeaker = line.speaker === "agent" ? "assistant" : line.speaker === "caller" ? "caller" : "system";
    out.push({ kind: "line", speaker, text, timestamp: line.timestamp, undelivered: line.state === "undelivered" });
  }
  return out;
}

/**
 * The full (unmasked) transcript may only be shown when the backend audits
 * the reveal (Sprint 8 PII rules — FE2 API ask). The flag arrives on
 * `status.capabilities.transcript_reveal_audited`; until then the toggle is
 * absent and the page says why.
 */
export function useTranscriptRevealAudited(): boolean {
  const status = useVoiceStatus();
  const caps = (status.data as { capabilities?: Record<string, unknown> } | undefined)?.capabilities;
  return caps?.transcript_reveal_audited === true;
}

// ── CSV ──────────────────────────────────────────────────────────────────

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Client-side CSV of the current filter, masked numbers only (server export is an API ask). */
export function buildCsv(
  calls: OwnerCall[],
  labels: { headers: string[]; result: (g: ResultGroup) => string; intent: (k: IntentKey) => string; direction: (d: string) => string },
  mask: (n: string) => string,
): string {
  const rows = [labels.headers.map(csvCell).join(";")];
  for (const c of calls) {
    rows.push(
      [
        c.started_at,
        labels.direction(c.direction),
        c.contactName ?? "",
        mask(c.number),
        labels.result(c.resultGroup),
        c.direction === "inbound" ? labels.intent(c.intentKey) : purposePreview(c),
        c.duration_seconds,
        c.appointment?.status ?? "",
        c.language ?? "",
      ]
        .map(csvCell)
        .join(";"),
    );
  }
  return `${rows.join("\n")}\n`;
}

// ── Detail ───────────────────────────────────────────────────────────────

export function isLive(call: Pick<CallSummary, "status"> | undefined): boolean {
  return Boolean(call && LIVE_STATUSES.has((call.status ?? "").toLowerCase()));
}

/** Invalidate everything a call mutation can change. */
export function useInvalidateCalls() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["voice", "calls"] });
    void qc.invalidateQueries({ queryKey: ["voice", "active"] });
    void qc.invalidateQueries({ queryKey: ["voice", "messages"] });
  };
}

export { computeAttention };
export type { CallDetail };
