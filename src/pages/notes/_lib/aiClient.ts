/**
 * The AI client for /notes. There is no mock behind it (FE-5 §1).
 *
 * It began as a drop-in replacement for the Docs mock, and the signatures still
 * match it, but the last mocked call — `runPreset` in the bubble menu — went
 * with the preset submenu in FE-5 §3. `aiGates.test.ts` keeps it that way: no
 * file under `src/pages/notes` may name that module again, in code or in prose,
 * so the gate stays a plain string search with nothing to argue about.
 *
 * All streaming goes through `_lib/sse.ts`, the module's single SSE reader.
 */

import type { Decision, LinkCandidate, LinkSuggestion, Task } from '@/pages/notes/_lib/types';
import { apiFetch } from '@/auth/apiFetch';
import { env } from '@/lib/env';
import { sseJsonFrames } from '@/pages/notes/_lib/sse';

/**
 * A citation points at a note, or — once FE-4's document ingest is live — at a
 * page of a source file. `noteId` stays required so every existing consumer
 * keeps working; a document citation carries the extra fields alongside it.
 */
export interface Citation {
  noteId: string;
  title: string;
  snippet?: string;
  /** FE-4: the ingested file the passage came from, when it was not a note. */
  documentId?: string;
  /** 1-based page within `documentId`. */
  page?: number;
  /** Character offsets into the source, for scrolling to the passage. */
  offset?: { from: number; to: number };
}

/**
 * Where an answer was computed — shown in every answer's footer (§6).
 *
 * This is not telemetry. For a firm whose material is privileged, "which
 * company's machine did my client's file go to" is the question that decides
 * whether the feature may be used at all, and the answer belongs on screen next
 * to the output rather than in a compliance PDF nobody opens.
 */
export interface AnswerMeta {
  provider: string;
  model: string;
  /** `EU`, `US`, or `local` for an on-premise runtime. */
  region: string;
}

/** `Anthropic · EU` / `Lokal (Ollama) · dieser Rechner`, in this module's English. */
export function describeMeta(meta: AnswerMeta): string {
  if (meta.region === 'local') return `${meta.provider} · this machine`;
  return `${meta.provider} · ${meta.region}`;
}

/** What the sidebar passes today; only the id and scope reach the server. */
export interface NoteRef {
  id: string;
}

export type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

let fetcher: Fetcher = apiFetch;

export function setFetcher(f: Fetcher) {
  fetcher = f;
}

export function resetFetcher() {
  fetcher = apiFetch;
}

export class AiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** 402. `resetAt` is ms-epoch, for "resets at {time}" in the failure state. */
export class BudgetExceededError extends AiError {
  constructor(readonly resetAt: number) {
    super(402, 'budget_exceeded', 'Daily AI budget reached');
  }
}

/**
 * Fired when the server reports ≥80% of the daily budget. The header arrives on
 * an ordinary successful response, so surfacing it is a side channel rather
 * than a return value — subscribe once and throttle the toast per session.
 */
type BudgetWarningListener = (ratio: number) => void;
const budgetWarningListeners = new Set<BudgetWarningListener>();

export function onBudgetWarning(listener: BudgetWarningListener): () => void {
  budgetWarningListeners.add(listener);
  return () => budgetWarningListeners.delete(listener);
}

function checkWarning(response: Response) {
  const raw = response.headers.get('X-AI-Budget-Warning');
  if (raw) {
    const ratio = Number(raw);
    if (!Number.isNaN(ratio)) budgetWarningListeners.forEach((l) => l(ratio));
  }
}

function budgetError(response: Response): BudgetExceededError {
  return new BudgetExceededError(Number(response.headers.get('X-AI-Budget-Reset-At') ?? 0) || 0);
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetcher(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  checkWarning(response);

  if (response.status === 402) throw budgetError(response);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new AiError(
      response.status,
      payload?.error ?? 'ai_failed',
      payload?.message ?? 'AI request failed',
    );
  }
  return (await response.json()) as T;
}

// ── the five extraction/suggestion calls ─────────────────────────────────

export async function extractTasks(text: string, signal?: AbortSignal): Promise<Task[]> {
  const { tasks } = await post<{ tasks: Task[] }>('/v1/ai/extract-tasks', { text }, signal);
  return tasks;
}

export async function extractDecisions(text: string, signal?: AbortSignal): Promise<Decision[]> {
  const { decisions } = await post<{ decisions: Decision[] }>(
    '/v1/ai/extract-decisions',
    { text },
    signal,
  );
  return decisions;
}

export async function suggestTags(
  noteContent: string,
  existingTags: string[],
  signal?: AbortSignal,
): Promise<string[]> {
  const { tags } = await post<{ tags: string[] }>(
    '/v1/ai/suggest-tags',
    { content: noteContent, existingTags },
    signal,
  );
  return tags;
}

/**
 * The server rebuilds the candidate pool itself and filters anything the model
 * invents back out, so `candidates` is a hint rather than the whole input —
 * and a suggestion can never point at something that doesn't exist.
 */
export async function suggestLinks(
  noteId: string,
  candidates: LinkCandidate[],
  signal?: AbortSignal,
): Promise<LinkSuggestion[]> {
  const { suggestions } = await post<{ suggestions: LinkSuggestion[] }>(
    '/v1/ai/suggest-links',
    { noteId, candidates },
    signal,
  );
  return suggestions;
}

/**
 * The three scopes behind the panel's toggle (§4).
 *
 * `note+linked+recent` is the wire name the backend has used since Sprint 3 and
 * is what "this note" sends. `notebook` is the client-matter scope — in this
 * module a notebook *is* the matter — and rides with a `notebookId`.
 */
export type AnswerScope = 'note+linked+recent' | 'notebook' | 'all';

export interface AskOptions {
  signal?: AbortSignal;
  scope?: AnswerScope;
  /** Required by `scope: 'notebook'`; ignored otherwise. */
  notebookId?: string | null;
  /** Inline "Ask…" passes the selected text so the answer is about it. */
  selection?: string | null;
}

export interface AnswerPart {
  chunk: string;
  citations?: Citation[];
  meta?: AnswerMeta;
}

/**
 * Streaming answer — the same `AsyncIterable<{chunk, citations?}>` shape the
 * mock promised, now with a `meta` part carrying provider/model/region.
 *
 * The client never ships note bodies: it sends an id and a scope and the server
 * assembles its own context. Aborting `signal` closes the SSE connection, which
 * is what tells the server to cancel the provider stream and bill only what was
 * actually consumed — so abort is a cost control, not just a UI nicety.
 *
 * There is deliberately no reconnect. A half-answer resumed from freshly
 * retrieved context is a different answer wearing the first one's opening
 * sentence; the panel offers "Ask again" instead.
 */
export async function* answerOverNotes(
  question: string,
  notes: NoteRef[],
  signalOrOptions?: AbortSignal | AskOptions,
  legacyScope: AnswerScope = 'note+linked+recent',
): AsyncIterable<AnswerPart> {
  // Callers from Sprint 3 pass `(q, notes, signal, scope)`; FE-5 callers pass an
  // options object. Both are supported so the panel could migrate on its own.
  const options: AskOptions =
    signalOrOptions && 'signal' in (signalOrOptions as AskOptions)
      ? (signalOrOptions as AskOptions)
      : { signal: signalOrOptions as AbortSignal | undefined, scope: legacyScope };

  const scope = options.scope ?? legacyScope;

  const response = await fetcher('/v1/ai/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      question,
      noteId: notes[0]?.id,
      scope,
      ...(scope === 'notebook' && options.notebookId ? { notebookId: options.notebookId } : {}),
      ...(options.selection ? { selection: options.selection } : {}),
    }),
    signal: options.signal,
  });

  checkWarning(response);

  if (response.status === 402) throw budgetError(response);
  if (!response.ok || !response.body) {
    throw new AiError(response.status, 'ai_failed', 'The answer stream could not be opened');
  }

  for await (const frame of sseJsonFrames(response.body)) {
    if (frame.event === 'chunk' || frame.event === 'text') {
      yield { chunk: String(frame.data.chunk ?? frame.data.text ?? '') };
    } else if (frame.event === 'citations') {
      // Citations arrive once, before `done` — emitted with an empty chunk so a
      // consumer's accumulate loop needs no special case.
      yield { chunk: '', citations: (frame.data.citations ?? []) as Citation[] };
    } else if (frame.event === 'meta') {
      yield { chunk: '', meta: readMeta(frame.data) };
    } else if (frame.event === 'error') {
      throw new AiError(
        500,
        String(frame.data.error ?? 'ai_failed'),
        String(frame.data.message ?? 'AI failed'),
      );
    } else if (frame.event === 'done') {
      // `done` may carry the meta rather than a separate frame; either is fine.
      if (frame.data.provider) yield { chunk: '', meta: readMeta(frame.data) };
      return;
    }
  }

  // Falling out of the loop without `done` means the body closed early. The
  // caller keeps what arrived and marks it incomplete — see `AnswerIncomplete`.
  throw new AnswerIncomplete();
}

/**
 * The stream ended without a `done` frame. Distinct from `AiError` because the
 * partial answer on screen is real and worth keeping; only its completeness is
 * in doubt, and saying "failed" over readable output is a lie.
 */
export class AnswerIncomplete extends AiError {
  constructor() {
    super(0, 'incomplete', 'The answer stopped before it finished');
  }
}

function readMeta(data: Record<string, unknown>): AnswerMeta {
  return {
    provider: String(data.provider ?? 'unknown'),
    model: String(data.model ?? 'unknown'),
    region: String(data.region ?? 'unknown'),
  };
}

// ── agent chat (Sprint 4 §4.2) ───────────────────────────────────────────

/**
 * The turn protocol. Every write the agent wants to make stops the turn at
 * `approval_required` and nothing is held open — the client resumes with
 * `continueAgentTurn` after the user decides (ADR 0006).
 */
export type AgentEvent =
  | { event: 'session'; sessionId: string }
  | { event: 'chunk'; chunk: string }
  /** Reasoning. Collapsed by default and given no visual drama (§9.3). */
  | { event: 'thinking'; text: string }
  | { event: 'tool_call'; tool: string; inputPreview: string; input?: Record<string, unknown> }
  | { event: 'tool_result'; summary: string }
  | {
      event: 'approval_required';
      actionId: string;
      tool: string;
      input: Record<string, unknown>;
      explanation: string;
      /** Present once BE-4 sends it; the card degrades without them. */
      noteId?: string;
      diff?: ActionDiff;
      costUsd?: number;
      expiresAt?: number;
    }
  | { event: 'budget_warning'; ratio: number; resetAt?: number }
  | { event: 'done'; costUsd: number; toolCalls: number; meta?: AnswerMeta }
  | { event: 'error'; error: string; message: string; resetAt?: number };

/** A before/after pair the approval card renders as a line-level diff. */
export interface ActionDiff {
  before: string;
  after: string;
}

/**
 * The spec names two of these events `pending_approval` and `text`, while the
 * backend has emitted `approval_required` and `chunk` since Sprint 4. Rather
 * than pick a side and have one of them break, both spellings are accepted and
 * normalised here — the rest of the app only ever sees the Sprint 4 names.
 */
const EVENT_ALIASES: Record<string, string> = {
  pending_approval: 'approval_required',
  text: 'chunk',
};

async function* agentStream(
  path: string,
  init: RequestInit,
  signal?: AbortSignal,
): AsyncIterable<AgentEvent> {
  const response = await fetcher(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(init.headers ?? {}) },
    signal,
  });

  checkWarning(response);

  if (response.status === 402) throw budgetError(response);
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null);
    throw new AiError(
      response.status,
      payload?.error ?? 'agent_failed',
      payload?.message ?? 'The agent stream could not be opened',
    );
  }

  for await (const frame of sseJsonFrames(response.body)) {
    const event = EVENT_ALIASES[frame.event] ?? frame.event;
    // `text` frames name their payload `text`; `chunk` frames name it `chunk`.
    // Normalising the field alongside the event name keeps the alias honest.
    if (event === 'chunk' && frame.data.chunk === undefined && frame.data.text !== undefined) {
      yield { event: 'chunk', chunk: String(frame.data.text) };
      continue;
    }
    yield { event, ...frame.data } as AgentEvent;
  }
}

export function agentChat(
  message: string,
  sessionId?: string,
  signal?: AbortSignal,
): AsyncIterable<AgentEvent> {
  return agentStream(
    '/v1/agent/chat',
    { method: 'POST', body: JSON.stringify(sessionId ? { message, sessionId } : { message }) },
    signal,
  );
}

/** Resume after an approve/reject — a fresh stream over persisted state. */
export function continueAgentTurn(
  sessionId: string,
  signal?: AbortSignal,
): AsyncIterable<AgentEvent> {
  return agentStream(`/v1/agent/chat/${sessionId}/continue`, { method: 'GET' }, signal);
}

// ── spend summary (settings panel) ───────────────────────────────────────

export type SpendRange = 'today' | '7d' | '30d';

export interface AiSpendSummary {
  costUsd: number;
  calls: number;
  byKind: Record<string, number>;
  /** The tenant's daily cap, when the server reports one. Drives the bar. */
  dailyBudgetUsd?: number;
  /** Per-day totals for the chart. Absent on an older backend. */
  series?: Array<{ date: string; costUsd: number; byKind?: Record<string, number> }>;
}

export async function spendSummary(range: SpendRange = 'today'): Promise<AiSpendSummary> {
  const response = await fetcher(`/v1/agent/actions/summary?range=${range}`);
  if (!response.ok) throw new AiError(response.status, 'summary_failed', 'Could not load AI usage');
  return (await response.json()) as AiSpendSummary;
}

// ── tenant AI configuration (§6) ─────────────────────────────────────────

/**
 * What the workspace is configured to do, as opposed to what it last did.
 *
 * The settings panel used to infer the provider from the most recent audited
 * action, which is honest but useless before the first call and misleading
 * right after a config change. `GET /v1/ai/config` is the real answer; until
 * BE-4 ships it the call 404s and the panel falls back to last-used, which is
 * why `localOnly` is optional rather than defaulted to `false` — claiming a
 * workspace is *not* local-only when we simply do not know would put a
 * reassurance on screen that nobody verified.
 */
export interface AiConfig {
  provider: string;
  model: string;
  region: string;
  localOnly?: boolean;
  dailyBudgetUsd?: number;
  /** Whether the caller may change any of the above. */
  editable?: boolean;
}

export async function aiConfig(signal?: AbortSignal): Promise<AiConfig | null> {
  const response = await fetcher('/v1/ai/config', { signal });
  if (response.status === 404) return null; // backend predates the endpoint
  if (!response.ok) throw new AiError(response.status, 'config_failed', 'Could not load AI settings');
  return (await response.json()) as AiConfig;
}

export async function updateAiConfig(patch: Partial<AiConfig>): Promise<AiConfig> {
  const response = await fetcher('/v1/ai/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new AiError(
      response.status,
      payload?.error ?? 'config_failed',
      payload?.message ?? 'Could not save AI settings',
    );
  }
  return (await response.json()) as AiConfig;
}

/** The Agent tab stays hidden until BE-4 flips its own flag (§4). */
export const agentChatEnabled = env('VITE_NOTES_AGENT_CHAT') === '1';
