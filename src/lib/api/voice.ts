// src/lib/api/voice.ts
// API client + types for /api/voice/*. Follows the existing dashboard
// pattern: bearer token from the Pincer auth store, TanStack Query hooks.

import { useEffect, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
// Auth stays single-source: the voice endpoints live on the same Pincer
// backend as /api/chat and /api/status, so the token, the per-browser
// `X-Pincer-User` id and the error shape all come from pincerClient.
import { authedFetch, isConnected, PincerError, sendOneOffChat } from "@/lib/pincerClient";
import { useSession } from "@/stores/session";
import { request } from "@/lib/api/client";

// Re-exported so voice surfaces have one import for "is there a backend?".
export { isConnected };
import { REFETCH_INTERVALS } from "@/lib/constants";
import { sseFrames } from "@/lib/sse";

/**
 * Authenticated JSON fetch against the connected Pincer backend.
 *
 * FE0: an alias of `request()` in `@/lib/api/client` — one client for every
 * hook (headers, 422 field mapping, the 401 → logout contract). Kept under its
 * old name so the hooks below and their tests read unchanged.
 */
export const apiFetch = request;

import type { components } from "@/lib/api/generated/schema";

/**
 * A response/request shape exactly as the contract declares it.
 *
 * F0 cut list §3, "hand-written response types": a type that mirrors a
 * component in `generated/schema.d.ts` is a duplicate, and duplicates are how
 * the UI silently lies. Wire shapes alias the generated component; the
 * *view models* below (Thread, Commitment, InboundMessage, …) stay
 * hand-written on purpose — they rename and default wire fields for the owner
 * UI, and each names its wire counterpart so `scripts/check-types.mjs` can
 * tell the two apart.
 */
type Wire<K extends keyof components["schemas"]> = components["schemas"][K];

// ── Types (mirror src/pincer/api/voice.py schemas) ──────────────────

/**
 * @derives VoiceStatus
 * Adds the five limit/quiet-hours counters the receptionist header reads
 * (daily_calls_used/limit, quiet_hours_active/until, do_not_call_count). They
 * are served but undeclared — ask filed in docs/app/api-asks.md.
 */
export interface VoiceStatus {
  /** Voice feature switched on (contract field; older backends omit it). */
  enabled?: boolean;
  engine: string;
  language: string;
  consent_mode: string;
  outbound_enabled: boolean;
  voice_configured: boolean;
  webhook_base_configured: boolean;
  active_call_count: number;

  // ── Outbound guardrails (Sprint 8 T8.3) ──
  // Optional throughout: a backend that predates the limits work simply omits
  // them and the header strip renders nothing rather than inventing numbers.
  /** Outbound calls placed in the current day window. */
  daily_calls_used?: number;
  /** Configured ceiling; null means "no limit configured". */
  daily_calls_limit?: number | null;
  /** True while server-side quiet hours are suppressing outbound calls. */
  quiet_hours_active?: boolean;
  /** Local wall-clock time outbound resumes, e.g. "08:00". */
  quiet_hours_until?: string | null;
  /** Size of the do-not-call list. */
  do_not_call_count?: number;
  /** S15: whether the media fork for live listen-in is switched on at all. */
  listen_in_enabled?: boolean;
}

/**
 * @derives ActiveCall
 * Adds thread_id/thread_subject (S14 threading, served but undeclared) and
 * drops listener_capacity, which belongs to the operator listen-in surface.
 */
export interface ActiveCall {
  call_sid: string;
  direction: string;
  /** ISO start instant (contract field; the Übersicht ticks its duration from it). */
  started_at?: string;
  /** Contract field: the language the call is running in. */
  language?: string;
  caller_number: string;
  target_number: string;
  target_name: string;
  purpose: string;
  /**
   * First 120 chars of the task the agent is actually running under, as the
   * backend holds it. Empty for inbound calls. This is what the live row
   * shows: `purpose` is what a form once submitted, this is what was bound.
   */
  briefing_task_preview?: string;
  engine: string;
  duration_seconds: number;
  /** S14: the matter this live call is part of, if any. */
  thread_id?: string | null;
  thread_subject?: string | null;

  /**
   * S15: whether this call can be listened to right now — the feature is
   * enabled *and* Twilio's media fork actually attached. Absent on a backend
   * without listen-in, which is why the button appears from this field rather
   * than from a config guess.
   */
  listen_available?: boolean;
  /** How many people already have the call open. */
  listener_count?: number;
}

/**
 * How the call went, measured rather than judged (S16 §1).
 *
 * Every speech field is nullable on purpose: a voicemail, a no-answer and a
 * call that predates the feature all legitimately have nothing to report, and
 * a zeroed bar would be a claim. `method` says whether the timing was measured
 * or inferred — the UI has to label the inferred ones.
 */
export type CallAnalytics = Wire<"AnalyticsOut">;

export type Sentiment = "positive" | "neutral" | "mixed" | "negative";
export type SentimentTrajectory = "improving" | "stable" | "declining";
export type SentimentReason = "" | "too_short" | "not_conversed" | "extraction_failed";
export type AnalyticsMethod = "exact" | "estimated";

/** Exactly what the agent was told to do on one call, as stored at dial time. */
export type CallBriefing = Wire<"BriefingOut">;

/**
 * Turn-latency roll-up for one call — from the `TURN_LATENCY` events Sprint 5
 * T5.1 emits. Every number is milliseconds; nulls mean "that stage was never
 * timed on this call" (e.g. a call that never reached TTS).
 */
export interface LatencyStages {
  stt: number | null;
  llm_ttft: number | null;
  tts: number | null;
  total: number | null;
}

/** One conversational turn's stage timings — detail view only. */
export interface LatencyTurn {
  turn: number;
  stt_ms: number | null;
  llm_ttft_ms: number | null;
  tts_ms: number | null;
  total_ms: number | null;
}

export interface CallLatency {
  turns: number;
  p50_ms: number | null;
  p95_ms: number | null;
  stages_p50: LatencyStages;
  /** Detail-only. Absent on the list endpoint — the panel falls back to p50. */
  per_turn?: LatencyTurn[];
}

/** Sprint 5 targets the latency chip is coloured against (ms, p50 per turn). */
export const LATENCY_TARGET_GOOD_MS = 1_200;
export const LATENCY_TARGET_OK_MS = 2_000;

/**
 * Appointment state carried by a `schedule_appointment_call` (Sprint 6
 * T6.3/T6.4). `status` walks proposed → verified → calendar_created →
 * invitations_sent, and can end at `failed` / `no_slot` / `declined`.
 */
export type AppointmentStatus = string;

/** Known `AppointmentStatus` values, in the order the timeline walks them. */
export const APPOINTMENT_STEPS = [
  "proposed",
  "verified",
  "calendar_created",
  "invitations_sent",
] as const;

/** Terminal states that are not a step on the happy path. */
export const APPOINTMENT_TERMINAL = ["failed", "no_slot", "declined"] as const;

export interface AppointmentInfo {
  status: AppointmentStatus;
  agreed_datetime: string | null;
  duration_minutes: number | null;
  calendar_event_link: string | null;
  retry_count: number;
}

/** A slot the agent offered on the call. */
export interface AppointmentCandidate {
  start: string;
  end?: string | null;
  /** True for the slot the callee actually agreed to. */
  accepted?: boolean;
}

/** One dial attempt in a retried scheduling job. */
export interface AppointmentAttempt {
  attempt: number;
  call_sid?: string | null;
  at?: string | null;
  outcome?: string | null;
}

/** Everything the detail endpoint knows about the appointment. */
export interface AppointmentDetail extends AppointmentInfo {
  topic?: string | null;
  candidates?: AppointmentCandidate[];
  attendees?: string[];
  max_retries?: number | null;
  attempts?: AppointmentAttempt[];
  /**
   * Sprint 6's honesty rule: when the calendar write fails the appointment is
   * NOT reported as booked. This carries the reason, and `follow_up` what the
   * backend does about it.
   */
  calendar_error?: string | null;
  follow_up?: string | null;
}

/** A promise made on the call. The backend writes `{who, what, when}`. */
export interface Commitment {
  /** 'agent' | 'callee' — empty when the record predates the field. */
  who: string;
  what: string;
  when: string | null;
}

/** A proposed next action. The backend writes `{tool, reason, draft_args}`. */
export interface FollowUpSuggestion {
  tool: string;
  reason: string;
}

/** Structured end-of-call extraction (Sprint 3 T3.1). */
export interface CallOutcome {
  outcome: string;
  task_result?: string;
  key_facts?: string[];
  commitments?: Commitment[];
  follow_up_suggestions?: FollowUpSuggestion[];
  language?: string;
}

/**
 * @derives CallSummary
 * The owner list's row model: cost_total_usd instead of the contract's
 * cost_usd, plus language/appointment/outcome/latency, which the endpoint
 * serves without declaring. Ask filed in docs/app/api-asks.md.
 */
export interface CallSummary {
  call_sid: string;
  direction: string;
  status: string;
  from_number: string;
  to_number: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;

  // ── Added by the v2 API extension. All optional: an older backend omits
  // them and every surface that uses them renders nothing instead of a zero.
  /** BCP-47-ish language the call was conducted in, e.g. "en", "de". */
  language?: string | null;
  /** Sprint 9 T9.3 failure taxonomy, e.g. "no_answer", "stt_timeout". */
  failure_code?: string | null;
  /** The backend's sentence for that code ("Completed normally"). */
  failure_description?: string | null;
  /** Sprint 9 T9.1 `call_costs` roll-up, USD. */
  cost_total_usd?: number | null;
  /**
   * Why an inbound call came in (S12 §11). Null/absent for outbound calls and
   * for any backend that predates the receptionist.
   */
  inbound_intent?: InboundIntent | string | null;
  appointment?: AppointmentInfo | null;
  outcome?: CallOutcome | null;
  latency?: CallLatency | null;

  // ── S14: which matter this call belongs to. Optional throughout — a
  // backend without threads omits them, and every surface renders nothing
  // rather than an empty thread chip. `thread_id: ""` means "threadless".
  thread_id?: string | null;
  thread_subject?: string | null;

  // ── S16: the compact analytics the list chips need. Null everywhere the
  // call has no reading, which includes every call placed before the feature.
  sentiment?: Sentiment | string | null;
  talk_ratio?: number | null;
  method?: AnalyticsMethod | string | null;
}

export type TranscriptLine = Wire<"TranscriptLine">;

export type CallAction = Wire<"CallActionOut">;

/** Tool risk tier (S11 §3). */
export type ToolTier = "R" | "W" | "X";

/** Which gate a tool call went through (S11 §6). */
export type ApprovalMode = "auto" | "verbal" | "user" | "off";

/** Why an inbound call came in (S12 §11). */
export type InboundIntent =
  | "question"
  | "message"
  | "appointment"
  | "human"
  | "unknown"
  | "after_hours";

export const INBOUND_INTENTS: InboundIntent[] = [
  "question",
  "message",
  "appointment",
  "human",
  "unknown",
  "after_hours",
];

/**
 * What one call cost, per component (Sprint 9 `call_costs`). The dashboard
 * showed only the total; this is the row behind it — carrier minutes, speech
 * in and out, and the tokens the conversation actually burned.
 */
export interface CallCostBreakdown {
  engine?: string;
  language?: string;
  duration_seconds?: number;
  twilio_usd?: number;
  stt_seconds?: number;
  stt_usd?: number;
  tts_characters?: number;
  tts_usd?: number;
  llm_input_tokens?: number;
  llm_output_tokens?: number;
  llm_usd?: number;
  total_usd?: number;
  recorded_at?: string;
}

/**
 * @derives CallDetail
 * As CallSummary, plus tool_timeline. See the CallSummary note.
 */
export interface CallDetail extends CallSummary {
  /** Per-component cost. Null for calls the accounting never saw. */
  cost?: CallCostBreakdown | null;
  /** Null for inbound calls and for anything placed before briefings existed. */
  briefing?: CallBriefing | null;
  /** Null for calls that predate the feature, and for calls with no speech. */
  analytics?: CallAnalytics | null;
  transcript: TranscriptLine[];
  actions: CallAction[];
  /** E1: the same actions as an owner-readable timeline (`outcome` ok | denied | deferred). */
  tool_timeline?: ToolTimelineEntry[];
  /** Detail carries the candidates/attempts the list summary leaves out. */
  appointment?: AppointmentDetail | null;
}

export interface ToolTimelineEntry {
  tool: string;
  tier: string;
  outcome: "ok" | "denied" | "deferred" | string;
  ms: number;
  approval: string;
  reason: string;
  timestamp: string;
}

/**
 * @derives Contact
 * Carries opted_out (the DNC join the list endpoint applies) rather than the
 * contract's category, which no owner surface reads.
 */
export interface Contact {
  name: string;
  phone_number: string;
  notes: string;
  /** On the do-not-call list (Sprint 8 T8.3) — the UI refuses to dial them. */
  opted_out?: boolean;
}

export type InitiateCallIn = Wire<"InitiateCallIn">;

export type InitiateCallOut = Wire<"InitiateCallOut">;

// ── Hooks ────────────────────────────────────────────────────────────
// All queries are gated on a connected backend: with no token stored there
// is nothing to poll, and the page renders a connect prompt instead.

const VOICE_REFETCH = REFETCH_INTERVALS.VOICE ?? 5_000;

export function useVoiceConnected(): boolean {
  return isConnected();
}

export function useVoiceStatus() {
  return useQuery<VoiceStatus, PincerError>({
    queryKey: ["voice", "status"],
    queryFn: () => apiFetch("/api/voice/status"),
    refetchInterval: VOICE_REFETCH,
    enabled: isConnected(),
  });
}

// ── Voice config: runtime-switchable turn model (Sprint 5 T5.4) ─────

export type TurnModelChoice = Wire<"TurnModelChoice">;

export type VoiceConfig = Wire<"VoiceConfig">;

export function useVoiceConfig() {
  return useQuery<VoiceConfig, PincerError>({
    queryKey: ["voice", "config"],
    queryFn: () => apiFetch("/api/voice/config"),
    enabled: isConnected(),
  });
}

/**
 * Switch the model used for live voice turns. Applied by the backend to the
 * very NEXT turn of any active call and persisted across restarts
 * (data_dir/voice_runtime.json).
 */
export function useUpdateVoiceConfig() {
  const qc = useQueryClient();
  return useMutation<VoiceConfig, PincerError, string>({
    mutationFn: (voice_turn_model) =>
      apiFetch("/api/voice/config", {
        method: "PUT",
        body: JSON.stringify({ voice_turn_model }),
      }),
    onSuccess: (data) => qc.setQueryData(["voice", "config"], data),
  });
}

export function useActiveCalls() {
  return useQuery<ActiveCall[], PincerError>({
    queryKey: ["voice", "active"],
    queryFn: () => apiFetch("/api/voice/active"),
    refetchInterval: 2_000, // live section polls faster than the history
    enabled: isConnected(),
  });
}

/**
 * Backend hard cap on `/api/voice/calls?limit=` (see api/voice.py:
 * `Query(default=50, ge=1, le=200)`). Asking for more is a 422, so history is
 * fetched in chunks of exactly this size.
 */
export const CALL_HISTORY_CHUNK = 200;

/** Safety cap on how much history is pulled into the browser at once. */
export const CALL_HISTORY_MAX = 1_000;

/** History polls slower than the live sections — finished calls do not move. */
const VOICE_HISTORY_REFETCH = 15_000;

/**
 * Whole call history, fetched in backend-sized chunks and accumulated client
 * side.
 *
 * `/api/voice/calls` returns a bare array with no total count, so paging it
 * server-side would leave the table unable to say how many calls exist, and
 * search/duration filters would only ever see the current page. Pulling the
 * full set (bounded by `max`) instead lets the table filter, sort and paginate
 * over everything. Chunks after the first are fetched automatically.
 */
export function useCallHistoryAll(max = CALL_HISTORY_MAX) {
  const q = useInfiniteQuery<CallSummary[], PincerError, InfiniteData<CallSummary[]>, string[], number>({
    queryKey: ["voice", "calls", "all"],
    queryFn: ({ pageParam }) =>
      apiFetch(`/api/voice/calls?limit=${CALL_HISTORY_CHUNK}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (lastChunk, chunks) =>
      lastChunk.length < CALL_HISTORY_CHUNK ? undefined : chunks.length * CALL_HISTORY_CHUNK,
    refetchInterval: VOICE_HISTORY_REFETCH,
    enabled: isConnected(),
  });

  const calls = useMemo(() => (q.data?.pages ?? []).flat(), [q.data]);
  const belowCap = calls.length < max;
  const canAutoFetch = q.hasNextPage && belowCap && !q.isFetchingNextPage;
  const { fetchNextPage } = q;

  useEffect(() => {
    if (canAutoFetch) void fetchNextPage();
  }, [canAutoFetch, fetchNextPage]);

  return {
    calls,
    isLoading: q.isLoading,
    /** True while the tail of the history is still streaming in. */
    isLoadingMore: q.isFetchingNextPage || canAutoFetch,
    isError: q.isError,
    error: q.error,
    isRefetching: q.isRefetching,
    refetch: q.refetch,
    /** More calls exist on the server than the `max` cap allows loading. */
    cappedAt: q.hasNextPage && !belowCap ? calls.length : null,
    loadMore: () => void fetchNextPage(),
  };
}

export function useCallDetail(callSid: string | null) {
  return useQuery<CallDetail, PincerError>({
    queryKey: ["voice", "call", callSid],
    queryFn: () => apiFetch(`/api/voice/calls/${callSid}`),
    enabled: !!callSid && isConnected(),
  });
}

/**
 * Detail for an in-progress call: the backend stores finalized transcript
 * lines and actions as the call runs, so polling the same detail endpoint
 * every 2s gives a real live transcript feed.
 */
export function useLiveCallDetail(callSid: string | null) {
  return useQuery<CallDetail, PincerError>({
    queryKey: ["voice", "call-live", callSid],
    queryFn: () => apiFetch(`/api/voice/calls/${callSid}`),
    enabled: !!callSid && isConnected(),
    refetchInterval: 2_000,
  });
}

/**
 * Ask the agent for a call summary WITHOUT touching the user's chat thread.
 *
 * /api/chat/message is stateful per conversation: in the user's own chat, the
 * agent answers inside the ongoing conversation — which produced replies about
 * *previous* chat context instead of the transcript. So each summary runs in a
 * conversation of its own, without the user's long-term memory: no other
 * call's transcript or remembered fact is in context, and the exchange stays
 * out of both the user's chat and their memory.
 */
export async function generateCallSummary(transcript: string): Promise<string> {
  const prompt =
    "You are acting as a summarization function, not a conversational assistant. " +
    "Ignore any previous conversation or memory — respond ONLY based on the transcript below. " +
    "Write a call summary for a business owner in the language of the transcript, under 120 words, " +
    "covering: outcome, key facts, commitments made, recommended next steps. " +
    "No greeting, no questions back, no emojis — output the summary text only. " +
    "If the call has no business content (e.g. a test call), say that in one sentence.\n\n" +
    "TRANSCRIPT:\n" + transcript;

  return sendOneOffChat(prompt);
}

export function useContacts() {
  return useQuery<Contact[], PincerError>({
    queryKey: ["voice", "contacts"],
    queryFn: () => apiFetch("/api/voice/contacts"),
    enabled: isConnected(),
  });
}

export function useInitiateCall() {
  const qc = useQueryClient();
  return useMutation<InitiateCallOut, PincerError, InitiateCallIn>({
    mutationFn: (body) =>
      apiFetch("/api/voice/calls", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["voice", "active"] });
      qc.invalidateQueries({ queryKey: ["voice", "calls"] });
      // Placing a call moves the daily-limit counter in the header strip.
      qc.invalidateQueries({ queryKey: ["voice", "status"] });
      // …and adds an entry to whichever thread it landed in.
      qc.invalidateQueries({ queryKey: ["voice", "threads"] });
      qc.invalidateQueries({ queryKey: ["voice", "thread"] });
    },
  });
}

// ── Structured outcome normalisation ─────────────────────────────────
//
// `commitments` and `follow_up_suggestions` arrive as arrays of *objects*, and
// an object rendered as a React child throws — taking the whole page down with
// it, not just the panel. So anything claiming to be an outcome is normalised
// here, once, and every field the UI touches is a string by the time it is
// rendered. This runs over both the top-level `outcome` field (v2 API) and the
// JSON blob on the `outcome` action (how older calls carry it).

const asText = (v: unknown): string => (v == null ? "" : String(v).trim());

function toStrList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(asText).filter(Boolean);
}

/** Bare strings are still accepted: older calls were written that way. */
function toCommitments(v: unknown): Commitment[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item): Commitment | null => {
      if (typeof item !== "object" || item === null) {
        const what = asText(item);
        return what ? { who: "", what, when: null } : null;
      }
      const o = item as Record<string, unknown>;
      const what = asText(o.what);
      return what ? { who: asText(o.who), what, when: asText(o.when) || null } : null;
    })
    .filter((c): c is Commitment => c !== null);
}

function toSuggestions(v: unknown): FollowUpSuggestion[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item): FollowUpSuggestion | null => {
      if (typeof item !== "object" || item === null) {
        const reason = asText(item);
        return reason ? { tool: "", reason } : null;
      }
      const o = item as Record<string, unknown>;
      const tool = asText(o.tool);
      const reason = asText(o.reason);
      return tool || reason ? { tool, reason } : null;
    })
    .filter((s): s is FollowUpSuggestion => s !== null);
}

/** Returns null for anything that is not recognisably an outcome record. */
export function normalizeOutcome(raw: unknown): CallOutcome | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  if (!("outcome" in data)) return null;
  return {
    outcome: asText(data.outcome),
    task_result: asText(data.task_result),
    key_facts: toStrList(data.key_facts),
    commitments: toCommitments(data.commitments),
    follow_up_suggestions: toSuggestions(data.follow_up_suggestions),
    language: asText(data.language) || undefined,
  };
}

// ── Appointment scheduling (Sprint 6 T6.1) ───────────────────────────

/**
 * Body of `POST /api/voice/schedule`, which wraps the backend's
 * `schedule_appointment_call` tool. Auth semantics are the same as
 * `POST /api/voice/calls`: the request IS the approval.
 */
export type ScheduleAppointmentIn = Wire<"ScheduleAppointmentIn">;

/**
 * @derives ScheduleAppointmentOut
 * The contract declares only `message`/`status`; the endpoint also returns the
 * call sid, which every caller needs to link the toast to the call. Listed as
 * an ask (docs/app/api-asks.md) — declare `call_sid` and this becomes an alias.
 */
export interface ScheduleAppointmentOut {
  call_sid: string;
}

/**
 * Ask the agent to call someone and book a slot.
 *
 * Errors are surfaced verbatim by callers: "no free slots", daily limit, quiet
 * hours, opt-out and validation all come back as a PincerError with the
 * backend's own `detail`, and inventing friendlier copy here would hide which
 * guardrail actually fired.
 */
export function useScheduleAppointment() {
  const qc = useQueryClient();
  return useMutation<ScheduleAppointmentOut, PincerError, ScheduleAppointmentIn>({
    mutationFn: (body) =>
      apiFetch("/api/voice/schedule", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["voice", "active"] });
      qc.invalidateQueries({ queryKey: ["voice", "calls"] });
      qc.invalidateQueries({ queryKey: ["voice", "status"] });
      qc.invalidateQueries({ queryKey: ["voice", "threads"] });
      qc.invalidateQueries({ queryKey: ["voice", "thread"] });
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════
// v3 — in-call tools (S11) & receptionist (S12)
// ═══════════════════════════════════════════════════════════════════════

// ── Approvals: `user` mode, decided while the callee is on hold ──────

export type ApprovalState = "pending" | "approved" | "denied" | "expired" | "call_ended";

/** Terminal states — the card flips to these and dismisses. */
export const APPROVAL_TERMINAL_STATES: ApprovalState[] = [
  "approved",
  "denied",
  "expired",
  "call_ended",
];

export interface VoiceApproval {
  id: string;
  call_sid: string;
  tool_name: string;
  /** S11's human-readable sentence, shown verbatim. */
  summary: string;
  args_preview: Record<string, string | number | boolean | null>;
  /** Absolute ISO-8601; the countdown is driven from this, not a local timer. */
  expires_at: string;
  /** Present on stream events; absent on the pending list (all pending). */
  state?: ApprovalState;
}

export interface ApprovalDecisionOut {
  id: string;
  state: ApprovalState;
}

/** How fast the pending list is polled while the stream is down. */
export const APPROVAL_POLL_MS = 3_000;
/** …and while it is up, where it is only a safety net. */
const APPROVAL_POLL_STREAMING_MS = 30_000;

/** The one place that knows where the approvals stream lives. */
const APPROVALS_STREAM_PATH = "/api/approvals/stream";
/** The one event name on that stream this client cares about. */
const VOICE_APPROVAL_EVENT = "voice_approval";

const APPROVALS_KEY = ["voice", "approvals", "pending"];

/** A bare array or an envelope; both are accepted. */
function asApprovalList(raw: unknown): VoiceApproval[] {
  if (Array.isArray(raw)) return raw as VoiceApproval[];
  const envelope = raw as { approvals?: VoiceApproval[] } | null;
  return envelope?.approvals ?? [];
}

type TerminalListener = (id: string, state: ApprovalState) => void;
const terminalListeners = new Set<TerminalListener>();

/**
 * Approvals pushed over the stream, held until they go terminal or expire.
 *
 * They cannot live only in the query cache: a poll that started before the push
 * resolves after it and would erase the card. A card outliving the list by a
 * few seconds is harmless; one that blinks out while a caller waits is not.
 */
const streamedPending = new Map<string, VoiceApproval>();

/**
 * Terminal approval events: decided elsewhere, expired, call ended. The card
 * needs them to show which state it reached, not just to stop counting.
 */
export function onApprovalTerminal(fn: TerminalListener): () => void {
  terminalListeners.add(fn);
  return () => terminalListeners.delete(fn);
}

/**
 * One shared stream connection, ref-counted: two subscribers opening two
 * streams would deliver every approval twice.
 */
let streamRefs = 0;
let streamAbort: AbortController | null = null;
const streamStateListeners = new Set<(up: boolean) => void>();

function setStreamUp(up: boolean) {
  streamStateListeners.forEach((fn) => fn(up));
}

async function runApprovalStream(onFrame: (a: VoiceApproval) => void) {
  let backoff = 1_000;

  while (streamAbort && !streamAbort.signal.aborted) {
    try {
      const res = await authedFetch(APPROVALS_STREAM_PATH, {
        headers: { Accept: "text/event-stream" },
        signal: streamAbort.signal,
      });
      if (!res.ok || !res.body) throw new PincerError(`HTTP ${res.status}`, res.status);

      setStreamUp(true);
      backoff = 1_000;

      for await (const frame of sseFrames(res.body)) {
        if (frame.event !== VOICE_APPROVAL_EVENT) continue; // chat/notes share the stream
        try {
          onFrame(JSON.parse(frame.data) as VoiceApproval);
        } catch {
          /* a malformed frame is dropped, not acted on */
        }
      }
    } catch (err) {
      // Signed out — including a 401 that just ended the session: retrying
      // cannot help. The hook starts a new stream on the next sign-in.
      if (err instanceof PincerError && err.status === 0) {
        setStreamUp(false);
        return;
      }
      /* otherwise fall through to the backoff below — polling covers the gap */
    }

    setStreamUp(false);
    if (!streamAbort || streamAbort.signal.aborted) return;
    // Exponential-ish backoff, capped: a backend that is down should not be
    // hammered, but an approval waiting 25s cannot wait a minute for a retry.
    await new Promise((r) => setTimeout(r, backoff));
    backoff = Math.min(backoff * 2, 10_000);
  }
}

/**
 * Pending `user`-mode approvals: stream first, poll as a fallback. The event is
 * what makes the card appear in about a second; the 3s poll is what makes it
 * appear at all when the stream is dead.
 */
export function usePendingApprovals() {
  const qc = useQueryClient();
  const [streaming, setStreaming] = useState(false);
  // Mounted at the app root, so it outlives sign-in and sign-out: follow the
  // session instead of what was true at mount.
  const connected = useSession((s) => s.connected);

  const query = useQuery<VoiceApproval[], PincerError>({
    queryKey: APPROVALS_KEY,
    queryFn: async () => asApprovalList(await apiFetch("/api/voice/approvals/pending")),
    refetchInterval: streaming ? APPROVAL_POLL_STREAMING_MS : APPROVAL_POLL_MS,
    enabled: connected,
    // A backend without the endpoint answers 404; retrying that every 3s is
    // not useful.
    retry: false,
  });

  useEffect(() => {
    if (!connected) return;

    const onUp = (up: boolean) => setStreaming(up);
    streamStateListeners.add(onUp);

    streamRefs += 1;
    if (streamRefs === 1) {
      streamAbort = new AbortController();
      void runApprovalStream((incoming) => {
        const state = incoming.state ?? "pending";
        if (state === "pending") {
          streamedPending.set(incoming.id, incoming);
          qc.setQueryData<VoiceApproval[]>(APPROVALS_KEY, (prev = []) => [
            ...prev.filter((a) => a.id !== incoming.id),
            incoming,
          ]);
        } else {
          streamedPending.delete(incoming.id);
          qc.setQueryData<VoiceApproval[]>(APPROVALS_KEY, (prev = []) =>
            prev.filter((a) => a.id !== incoming.id),
          );
          terminalListeners.forEach((fn) => fn(incoming.id, state));
        }
      });
    }

    return () => {
      streamStateListeners.delete(onUp);
      streamRefs -= 1;
      if (streamRefs === 0) {
        streamAbort?.abort();
        streamAbort = null;
      }
    };
  }, [qc, connected]);

  // What the server last listed, plus anything the stream announced since,
  // minus anything already expired.
  const approvals = useMemo(() => {
    const byId = new Map<string, VoiceApproval>();
    for (const a of query.data ?? []) byId.set(a.id, a);
    for (const [id, a] of streamedPending) if (!byId.has(id)) byId.set(id, a);
    const now = Date.now();
    return [...byId.values()].filter((a) => new Date(a.expires_at).getTime() > now);
    // No dep on the streamed map: every push writes through setQueryData.
  }, [query.data]);

  return {
    approvals,
    isLoading: query.isLoading,
    /** True while the SSE stream is connected — the card is then near-instant. */
    streaming,
  };
}

/**
 * Approve or deny. A 409 is not an error to hide: the approval reached a
 * terminal state elsewhere and the card has to show that state.
 */
export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation<
    ApprovalDecisionOut,
    PincerError & { state?: ApprovalState },
    { id: string; decision: "approve" | "deny" }
  >({
    mutationFn: async ({ id, decision }) => {
      const res = await authedFetch(`/api/voice/approvals/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        detail?: string;
        state?: ApprovalState;
        id?: string;
      };
      if (!res.ok) {
        const err = new PincerError(body.detail ?? `HTTP ${res.status}`, res.status) as PincerError & {
          state?: ApprovalState;
        };
        // 409 carries the terminal state the server settled on.
        err.state = body.state;
        throw err;
      }
      return { id: body.id ?? id, state: body.state ?? (decision === "approve" ? "approved" : "denied") };
    },
    onSettled: (_data, _err, vars) => {
      streamedPending.delete(vars.id);
      qc.setQueryData<VoiceApproval[]>(APPROVALS_KEY, (prev = []) =>
        prev.filter((a) => a.id !== vars.id),
      );
    },
  });
}

// ── Messages inbox (S12 §11) ─────────────────────────────────────────

export interface InboundMessageCall {
  started_at?: string | null;
  duration_seconds?: number | null;
  inbound_intent?: InboundIntent | string | null;
  language?: string | null;
}

export interface InboundMessage {
  id: string;
  call_sid: string;
  caller_name: string | null;
  caller_number: string | null;
  matter: string;
  urgency: "normal" | "urgent" | string;
  /** The caller never confirmed the spelling / the number on the call. */
  name_unverified?: boolean;
  number_unverified?: boolean;
  delivery_state?: string;
  created_at: string;
  read_at?: string | null;
  call?: InboundMessageCall | null;
  /** S14: the thread the message's call belongs to, so a call-back lands in it. */
  thread_id?: string | null;
  thread_subject?: string | null;
}

export interface MessagesPage {
  messages: InboundMessage[];
  total: number;
  /** Server-side unread count; falls back to counting the loaded page. */
  unread: number;
}

const MESSAGES_REFETCH = 15_000;

function asMessagesPage(raw: unknown): MessagesPage {
  if (Array.isArray(raw)) {
    const messages = raw as InboundMessage[];
    return {
      messages,
      total: messages.length,
      unread: messages.filter((m) => !m.read_at).length,
    };
  }
  const env = (raw ?? {}) as Partial<MessagesPage>;
  const messages = env.messages ?? [];
  return {
    messages,
    total: env.total ?? messages.length,
    unread: env.unread ?? messages.filter((m) => !m.read_at).length,
  };
}

export function useMessages(opts: { unread?: boolean; limit?: number; offset?: number } = {}) {
  const { unread, limit = 100, offset = 0 } = opts;
  const qs = new URLSearchParams();
  if (unread) qs.set("unread", "true");
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));

  return useQuery<MessagesPage, PincerError>({
    queryKey: ["voice", "messages", { unread: !!unread, limit, offset }],
    queryFn: async () => asMessagesPage(await apiFetch(`/api/voice/messages?${qs}`)),
    refetchInterval: MESSAGES_REFETCH,
    enabled: isConnected(),
    retry: false,
  });
}

/** Unread count for the nav badge, without loading the list itself. */
export function useUnreadMessageCount() {
  const q = useQuery<MessagesPage, PincerError>({
    queryKey: ["voice", "messages", "unread-count"],
    queryFn: async () => asMessagesPage(await apiFetch("/api/voice/messages?unread=true&limit=1")),
    refetchInterval: MESSAGES_REFETCH,
    enabled: isConnected(),
    retry: false,
  });
  return q.data?.unread ?? 0;
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation<unknown, PincerError, string>({
    mutationFn: (id) => apiFetch(`/api/voice/messages/${id}/read`, { method: "POST" }),
    // Optimistic: the row must not flicker back to bold mid-POST.
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["voice", "messages"] });
      const now = new Date().toISOString();
      qc.setQueriesData<MessagesPage>({ queryKey: ["voice", "messages"] }, (page) =>
        page
          ? {
              ...page,
              unread: Math.max(0, page.unread - (page.messages.some((m) => m.id === id && !m.read_at) ? 1 : 0)),
              messages: page.messages.map((m) => (m.id === id ? { ...m, read_at: m.read_at ?? now } : m)),
            }
          : page,
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["voice", "messages"] }),
  });
}

// ── Receptionist profile & stats (S12 §4, §13) ───────────────────────

export interface BusinessHoursRange {
  open: string;
  close: string;
}

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export interface BusinessProfile {
  enabled: true;
  name: string;
  languages: string[];
  /** IANA zone; the open/closed indicator is computed in it. */
  timezone: string;
  hours: Partial<Record<Weekday, BusinessHoursRange[]>>;
  services_count: number;
  faq_count: number;
  booking: { enabled: boolean; duration_minutes: number | null };
  transfer: { enabled: boolean };
  after_hours: string | null;
}

/** `{enabled: false}` is a legitimate answer, not an error — the panel hides. */
export type ProfileResult = BusinessProfile | { enabled: false };

export function useReceptionistProfile() {
  return useQuery<ProfileResult, PincerError>({
    queryKey: ["voice", "receptionist", "profile"],
    queryFn: async () => {
      try {
        return await apiFetch<ProfileResult>("/api/voice/receptionist/profile");
      } catch (e) {
        // 404 means "not configured", which is a state rather than a failure.
        if (e instanceof PincerError && e.status === 404) return { enabled: false as const };
        throw e;
      }
    },
    staleTime: 60_000,
    enabled: isConnected(),
    retry: false,
  });
}

/** Counts, not percentages: the strip decides whether the sample earns a bar. */
export type SentimentDistribution = Wire<"SentimentDistribution">;

/**
 * @derives ReceptionistStats
 * The Übersicht's stat model: the seven owner-facing rates the endpoint
 * computes but does not declare. Ask filed in docs/app/api-asks.md.
 */
export interface ReceptionistStats {
  answered: number;
  intents: Partial<Record<InboundIntent, number>>;
  /** 0..1. A value > 1 is read as an already-multiplied percentage. */
  booking_conversion: number;
  transfer_rate: number;
  messages_taken: number;
  busy_capacity: number;
  silent_hangups: number;
  /** S16: how callers sounded over the window. Absent on an older backend. */
  sentiment_distribution?: SentimentDistribution;
}

export function useReceptionistStats(days = 7) {
  return useQuery<ReceptionistStats, PincerError>({
    queryKey: ["voice", "receptionist", "stats", days],
    queryFn: () => apiFetch(`/api/voice/receptionist/stats?days=${days}`),
    refetchInterval: 60_000,
    enabled: isConnected(),
    retry: false,
  });
}

// ── Blocklist (S12 §10.2) ────────────────────────────────────────────

export interface BlocklistEntry {
  number: string;
  reason: string;
  added_at?: string | null;
  /** "owner" for a direct add, "suggested" for an approved suggestion. */
  source?: string | null;
}

/** E.164, mirroring the server: same pattern, same message on rejection. */
export const E164_RE = /^\+[1-9]\d{7,14}$/;
export const E164_HINT = "Enter the number in international format, e.g. +4930123456";

export function useBlocklist() {
  return useQuery<BlocklistEntry[], PincerError>({
    queryKey: ["voice", "blocklist"],
    queryFn: () => apiFetch("/api/voice/blocklist"),
    enabled: isConnected(),
    retry: false,
  });
}

export function useAddToBlocklist() {
  const qc = useQueryClient();
  return useMutation<BlocklistEntry, PincerError, { number: string; reason: string }>({
    mutationFn: (body) =>
      apiFetch("/api/voice/blocklist", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voice", "blocklist"] }),
  });
}

export function useRemoveFromBlocklist() {
  const qc = useQueryClient();
  return useMutation<unknown, PincerError, string>({
    mutationFn: (number) =>
      apiFetch(`/api/voice/blocklist/${encodeURIComponent(number)}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voice", "blocklist"] }),
  });
}

// ── Tool policy (S11 §3) — read-only mirror ──────────────────────────

export interface PolicyOverride {
  tool: string;
  mode: ApprovalMode | string;
  reason?: string | null;
}

export interface WriteBudget {
  limit: number | null;
  used?: number | null;
  window?: string | null;
}

export interface VoicePolicy {
  global_mode: ApprovalMode | string;
  overrides: PolicyOverride[];
  write_budget: WriteBudget | null;
  tiers: { tool: string; tier: ToolTier | string }[];
}

export function useVoicePolicy() {
  return useQuery<VoicePolicy, PincerError>({
    queryKey: ["voice", "policy"],
    queryFn: () => apiFetch("/api/voice/policy"),
    staleTime: 60_000,
    enabled: isConnected(),
    retry: false,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// v4 — call threads (S14, against the S13 API)
// ═══════════════════════════════════════════════════════════════════════
//
// One matter, many calls. The thread is what the owner reads; the calls are
// the evidence underneath it.
//
// Naming note: S13 §9 calls the per-thread obligation `Commitment`, but this
// module already exports a `Commitment` — the per-call one inside `CallOutcome`
// — and the two are different shapes (`when` vs `due_at` + `status`). Two
// exports cannot share a name, so the thread-level one is `ThreadCommitment`.

export type ThreadStatus = "open" | "resolved" | "closed";

/** Why a call belongs to its thread. `manual` is the curation escape hatch. */
export type ThreadAttachKind =
  | "origin"
  | "retry"
  | "followup"
  | "inbound_matched"
  | "manual";

/** Which transitions the API accepts, mirrored so the UI never offers more. */
export const THREAD_TRANSITIONS: Record<ThreadStatus, ThreadStatus[]> = {
  open: ["resolved"],
  resolved: ["open", "closed"],
  closed: [],
};

export type CommitmentStatus = "open" | "done" | "expired";

export interface ThreadCommitment {
  /** 'callee' | 'agent' | 'user' — who owes the thing. */
  who: string;
  what: string;
  /** ISO-8601, or null when the call never pinned a date. */
  due_at: string | null;
  status: CommitmentStatus | string;
}

export interface Thread {
  id: string;
  subject: string;
  status: ThreadStatus | string;
  contact_name: string | null;
  contact_number: string;
  language?: string | null;
  call_count: number;
  created_at: string;
  updated_at: string;
  /**
   * Last line of `rolling_summary` — "where this stands". The list row shows
   * it without having to pull every thread's full summary.
   */
  state_line?: string | null;
  /** How many commitments are past due; drives the ❗ dot and the nav badge. */
  expired_commitment_count?: number;
}

/** A call as it appears inside its thread. */
export interface ThreadCall extends CallSummary {
  thread_attach_kind: ThreadAttachKind | string;
  /** One line of what the call achieved (from the structured outcome). */
  task_result?: string | null;
  /** Retention removed the transcript; the entry itself stays. */
  transcript_purged?: boolean;
}

/**
 * @derives ThreadDetail
 * View model, not the wire shape: ThreadDetailWire below is the contract's
 * ThreadDetail, and toThread()/toCommitment() map it — thread_id → id,
 * primary_number → contact_number, due → due_at — and derive state_line and
 * expired_commitment_count for the UI.
 */
export interface ThreadDetail extends Thread {
  rolling_summary: string;
  /** "updated after call N" — 1-based index into `calls`. */
  summary_updated_after_call?: number | null;
  commitments: ThreadCommitment[];
  calls: ThreadCall[];
}

export interface ThreadsPage {
  threads: Thread[];
  total: number;
}

// ── Wire shapes (what the merged S13 API actually sends) ────────────
//
// The API speaks `thread_id` / `primary_number` / `open_commitments`, carries
// the rolling summary on the list row, and sends thread calls as stubs rather
// than whole calls. The UI types above are what the screens were built on, so
// the translation happens once, here, instead of in nine components.

type CommitmentWire = Wire<"CommitmentOut">;

type ThreadWire = Wire<"ThreadOut">;

type ThreadCallWire = Wire<"ThreadCallOut">;

type ThreadDetailWire = Wire<"ThreadDetail">;

const toCommitment = (c: CommitmentWire): ThreadCommitment => ({
  who: c.who ?? "",
  what: c.what ?? "",
  due_at: c.due ?? null,
  status: c.status ?? "open",
});

/** "Where this stands" is the last line the summary ends on. */
export function stateLineOf(summary: string | undefined | null): string {
  const lines = (summary ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

function toThread(w: ThreadWire): Thread {
  const commitments = (w.open_commitments ?? []).map(toCommitment);
  return {
    id: w.thread_id,
    subject: w.subject ?? "",
    status: w.status ?? "open",
    contact_name: w.contact_name || null,
    contact_number: w.primary_number ?? "",
    language: w.language ?? null,
    call_count: w.call_count ?? 0,
    created_at: w.created_at ?? "",
    updated_at: w.updated_at ?? w.created_at ?? "",
    state_line: stateLineOf(w.rolling_summary),
    expired_commitment_count: commitments.filter((c) => c.status === "expired").length,
  };
}

/**
 * A thread call is a stub, not a `CallSummary`: the numbers and the language
 * belong to the thread, and the length is the difference between its two
 * timestamps. Filled in here so the timeline can show a call row without a
 * second request per entry.
 */
function toThreadCall(c: ThreadCallWire, w: ThreadWire): ThreadCall {
  const started = c.started_at ?? "";
  const ms = c.ended_at && started ? Date.parse(c.ended_at) - Date.parse(started) : NaN;
  const inbound = c.direction === "inbound";
  const number = w.primary_number ?? "";
  return {
    call_sid: c.call_sid,
    direction: c.direction ?? "",
    status: c.ended_at ? "completed" : "active",
    from_number: inbound ? number : "",
    to_number: inbound ? "" : number,
    started_at: started,
    ended_at: c.ended_at ?? null,
    duration_seconds: Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0,
    language: w.language ?? null,
    failure_code: c.failure_code || null,
    outcome: c.outcome || c.task_result ? { outcome: c.outcome ?? "", task_result: c.task_result } : null,
    thread_attach_kind: c.thread_attach_kind ?? "manual",
    sentiment: c.sentiment ?? null,
    task_result: c.task_result || null,
    transcript_purged: !!c.purged,
  };
}

function toThreadDetail(w: ThreadDetailWire): ThreadDetail {
  const calls = (w.calls ?? []).map((c) => toThreadCall(c, w));
  return {
    ...toThread(w),
    call_count: w.call_count ?? calls.length,
    rolling_summary: w.rolling_summary ?? "",
    summary_updated_after_call: calls.length || null,
    commitments: (w.open_commitments ?? []).map(toCommitment),
    calls,
  };
}

export interface ThreadQuery {
  /** Server-side status filter; omitted means the API's default. */
  status?: ThreadStatus[];
  /** Server-side text search over subject and contact. */
  q?: string;
  /** Only threads carrying at least one expired commitment. */
  expiredOnly?: boolean;
}

/** The API sends a bare array; an envelope is accepted too. */
function asThreadsPage(raw: unknown): ThreadsPage {
  if (Array.isArray(raw)) {
    const threads = (raw as ThreadWire[]).map(toThread);
    return { threads, total: threads.length };
  }
  const env = (raw ?? {}) as { threads?: ThreadWire[]; total?: number };
  const threads = (env.threads ?? []).map(toThread);
  return { threads, total: env.total ?? threads.length };
}

function threadQs({ status, q, expiredOnly }: ThreadQuery): string {
  const qs = new URLSearchParams();
  for (const s of status ?? []) qs.append("status", s);
  if (q?.trim()) qs.set("q", q.trim());
  if (expiredOnly) qs.set("has_expired_commitments", "true");
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function useThreads(params: ThreadQuery = {}) {
  const { status, q, expiredOnly } = params;
  return useQuery<ThreadsPage, PincerError>({
    queryKey: ["voice", "threads", { status, q, expiredOnly: !!expiredOnly }],
    queryFn: async () => asThreadsPage(await apiFetch(`/api/voice/threads${threadQs(params)}`)),
    refetchInterval: VOICE_REFETCH,
    enabled: isConnected(),
    retry: false,
  });
}

export function useThread(id: string | null) {
  return useQuery<ThreadDetail, PincerError>({
    queryKey: ["voice", "thread", id],
    queryFn: async () =>
      toThreadDetail(await apiFetch<ThreadDetailWire>(`/api/voice/threads/${encodeURIComponent(id!)}`)),
    enabled: isConnected() && !!id,
    refetchInterval: VOICE_REFETCH,
    // A 404 is an answer, not a network blip: the deep link is stale.
    retry: false,
  });
}

/** Everything a thread mutation touches: the list, the thread, the calls. */
function invalidateThreads(qc: ReturnType<typeof useQueryClient>, id?: string) {
  qc.invalidateQueries({ queryKey: ["voice", "threads"] });
  if (id) qc.invalidateQueries({ queryKey: ["voice", "thread", id] });
  qc.invalidateQueries({ queryKey: ["voice", "calls"] });
}

export interface ThreadPatch {
  id: string;
  subject?: string;
  status?: ThreadStatus;
}

/**
 * Rename a thread, or move it along the status machine.
 *
 * The subject edit is optimistic — typing a title should feel like typing —
 * and rolls back on error; the caller shows the server's message. Status is
 * never forced locally: a rejected transition must leave the chip where the
 * server says it is (§6).
 */
export function usePatchThread() {
  const qc = useQueryClient();
  return useMutation<ThreadDetail, PincerError, ThreadPatch, { previous?: ThreadDetail }>({
    mutationFn: async ({ id, ...body }) =>
      toThreadDetail(
        await apiFetch<ThreadDetailWire>(`/api/voice/threads/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      ),
    onMutate: async ({ id, subject }) => {
      if (subject == null) return {};
      await qc.cancelQueries({ queryKey: ["voice", "thread", id] });
      const previous = qc.getQueryData<ThreadDetail>(["voice", "thread", id]);
      if (previous) qc.setQueryData<ThreadDetail>(["voice", "thread", id], { ...previous, subject });
      return { previous };
    },
    onError: (_err, { id }, ctx) => {
      if (ctx?.previous) qc.setQueryData(["voice", "thread", id], ctx.previous);
    },
    onSettled: (_data, _err, { id }) => invalidateThreads(qc, id),
  });
}

export interface CreateThreadIn {
  subject: string;
  contact_number: string;
  contact_name?: string;
  language?: string;
}

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation<ThreadDetail, PincerError, CreateThreadIn>({
    mutationFn: async ({ contact_number, ...rest }) =>
      toThreadDetail(
        await apiFetch<ThreadDetailWire>("/api/voice/threads", {
          method: "POST",
          body: JSON.stringify({ ...rest, primary_number: contact_number }),
        }),
      ),
    onSuccess: (t) => invalidateThreads(qc, t?.id),
  });
}

export interface AssignCallIn {
  /** Thread the call should end up in. */
  threadId: string;
  call_sid: string;
}

/** Attach a call to a thread — `manual` attach kind, the correction path. */
export function useAssignCall() {
  const qc = useQueryClient();
  return useMutation<ThreadDetail, PincerError, AssignCallIn>({
    mutationFn: async ({ threadId, call_sid }) =>
      toThreadDetail(
        await apiFetch<ThreadDetailWire>(`/api/voice/threads/${encodeURIComponent(threadId)}/assign`, {
          method: "POST",
          body: JSON.stringify({ call_sid }),
        }),
      ),
    onSettled: (_d, _e, { threadId }) => invalidateThreads(qc, threadId),
  });
}

export interface MergeThreadsIn {
  /** The thread that survives. */
  threadId: string;
  /** The thread whose calls move over, and which is then closed. */
  source_thread_id: string;
}

export function useMergeThreads() {
  const qc = useQueryClient();
  return useMutation<ThreadDetail, PincerError, MergeThreadsIn>({
    mutationFn: async ({ threadId, source_thread_id }) =>
      toThreadDetail(
        await apiFetch<ThreadDetailWire>(`/api/voice/threads/${encodeURIComponent(threadId)}/merge`, {
          method: "POST",
          body: JSON.stringify({ source_thread_id }),
        }),
      ),
    onSettled: (_d, _e, { threadId, source_thread_id }) => {
      invalidateThreads(qc, threadId);
      qc.invalidateQueries({ queryKey: ["voice", "thread", source_thread_id] });
    },
  });
}

// ── Do-not-call list (Sprint 8 T8.3) ─────────────────────────────────
//
// The one policy the dashboard can actually change: a number on this list is
// refused by the backend before a call is placed, whoever asks.

export type DoNotCallEntry = Wire<"DoNotCallEntry">;

export function useDoNotCall() {
  return useQuery<DoNotCallEntry[], PincerError>({
    queryKey: ["voice", "do-not-call"],
    queryFn: () => apiFetch("/api/voice/do-not-call"),
    enabled: isConnected(),
    retry: false,
  });
}

/** Adding is the whole point: the list is what stops the agent dialling. */
export function useAddDoNotCall() {
  const qc = useQueryClient();
  return useMutation<DoNotCallEntry, PincerError, { phone_number: string; reason?: string }>({
    mutationFn: (body) =>
      apiFetch("/api/voice/do-not-call", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["voice", "do-not-call"] });
      // The header strip counts them.
      qc.invalidateQueries({ queryKey: ["voice", "status"] });
      qc.invalidateQueries({ queryKey: ["voice", "contacts"] });
    },
  });
}

export function useRemoveDoNotCall() {
  const qc = useQueryClient();
  return useMutation<unknown, PincerError, string>({
    mutationFn: (phoneNumber) =>
      apiFetch(`/api/voice/do-not-call/${encodeURIComponent(phoneNumber)}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["voice", "do-not-call"] });
      qc.invalidateQueries({ queryKey: ["voice", "status"] });
      qc.invalidateQueries({ queryKey: ["voice", "contacts"] });
    },
  });
}

// ── Scheduled calls (S17) ────────────────────────────────────────────
//
// A call the owner wants placed later. The backend stores it as a one-off
// schedule and, when it comes due, places it down the ordinary outbound path —
// so a scheduled call meets the same do-not-call list, quiet hours and daily
// caps as one placed by hand, and its briefing is validated when it is
// written rather than at 23:10 with nobody watching.

export type ScheduledCall = Wire<"ScheduledCallOut">;

export type ScheduleCallIn = Wire<"ScheduledCallIn">;

export function useScheduledCalls() {
  return useQuery<ScheduledCall[], PincerError>({
    queryKey: ["voice", "scheduled-calls"],
    queryFn: () => apiFetch("/api/voice/calls/scheduled"),
    refetchInterval: VOICE_REFETCH * 6,
    enabled: isConnected(),
    retry: false,
  });
}

export function useScheduleCall() {
  const qc = useQueryClient();
  return useMutation<ScheduledCall, PincerError, ScheduleCallIn>({
    mutationFn: (body) =>
      apiFetch("/api/voice/calls/scheduled", {
        method: "POST",
        body: JSON.stringify({
          // The server reads a naive time in this zone; sending it makes
          // "09:15" mean the same thing on both sides of the wire.
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...body,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["voice", "scheduled-calls"] });
      // It also becomes a row in the agent's schedule list.
      qc.invalidateQueries({ queryKey: ["dash", "schedules"] });
    },
  });
}

export function useCancelScheduledCall() {
  const qc = useQueryClient();
  return useMutation<unknown, PincerError, number>({
    mutationFn: (id) => apiFetch(`/api/voice/calls/scheduled/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["voice", "scheduled-calls"] });
      qc.invalidateQueries({ queryKey: ["dash", "schedules"] });
    },
  });
}

