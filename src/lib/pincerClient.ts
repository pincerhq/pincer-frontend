/**
 * Pincer backend client.
 *
 * Talks to a Pincer FastAPI server over HTTP + Server-Sent Events.
 *
 * Auth model:
 *   - A person signs in with their identity's name or email and password
 *     (`POST /api/auth/login`) and gets an access token (short-lived JWT) plus
 *     a single-use refresh token. The pair is stored under `pincer.web.auth` —
 *     in sessionStorage (plus an in-memory copy) by default, in localStorage
 *     only when the person opted into "remember this device". Readers check
 *     the session record first, so the two never conflict.
 *   - `authedFetch` is the one place that keeps the pair alive: it refreshes
 *     shortly before expiry, and once more on a 401 `token_expired`. Only an
 *     answer about the token itself ends the session (`onAuthLost`).
 *   - Each browser still has a stable UUID (`pincer.web.userId`), sent as
 *     `X-Pincer-User` for the Notes service. Pincer itself ignores the header
 *     under a JWT: the signed-in identity is who the request is.
 *
 * Known limit: a *duplicated* tab that is not remembered copies the session
 * record, refresh token included. Refresh tokens are single-use, so whichever
 * copy refreshes second is signed out. Remembered tabs share localStorage and
 * coordinate through a Web Lock instead.
 */

const AUTH_KEY = "pincer.web.auth";
const USER_ID_KEY = "pincer.web.userId";
const REFRESH_LOCK = "pincer.web.auth.refresh";

/** The storage key of the session record, for `storage` event listeners. */
export const AUTH_STORAGE_KEY = AUTH_KEY;

export type PincerAuth = {
  apiUrl: string;
  /** The access token. */
  token: string;
  refreshToken: string;
  /** Epoch milliseconds at which the access token stops working. */
  expiresAt: number;
  /** The signed-in identity's `pincer_user_id`. */
  userId: string;
};

/** What `/api/auth/login` and `/api/auth/refresh` answer with. */
export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  pincer_user_id: string;
}

export function authFromTokenPair(apiUrl: string, pair: TokenPair): PincerAuth {
  return {
    apiUrl: normalizeApiUrl(apiUrl),
    token: pair.access_token,
    refreshToken: pair.refresh_token,
    expiresAt: Date.now() + pair.expires_in * 1000,
    userId: pair.pincer_user_id,
  };
}

// ───────────────────── config / identity ─────────────────────

// In-memory copy of the session-scoped record: survives a storage that throws
// (private mode, blocked site data) for the life of the page.
let memoryAuth: PincerAuth | null = null;

function storageOf(kind: "session" | "local"): Storage | undefined {
  try {
    return kind === "session" ? sessionStorage : localStorage;
  } catch {
    return undefined;
  }
}

function readStorage(storage: Storage | undefined): PincerAuth | null {
  try {
    const raw = storage?.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PincerAuth> | null;
    if (
      !parsed?.apiUrl ||
      !parsed.token ||
      !parsed.refreshToken ||
      typeof parsed.expiresAt !== "number" ||
      !parsed.userId
    ) {
      // A record from before per-identity sign-in ({apiUrl, token} with the
      // shared token) can never work again: drop it so the person lands on
      // the login instead of collecting 401s.
      storage?.removeItem(AUTH_KEY);
      return null;
    }
    return {
      apiUrl: normalizeApiUrl(parsed.apiUrl),
      token: parsed.token,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
      userId: parsed.userId,
    };
  } catch {
    return null;
  }
}

function readStoredAuth(): PincerAuth | null {
  return readStorage(storageOf("session")) ?? readStorage(storageOf("local"));
}

export function getAuth(): PincerAuth | null {
  if (memoryAuth) return memoryAuth;
  memoryAuth = readStoredAuth();
  return memoryAuth;
}

/**
 * Forget the in-memory copy so the next read comes from storage. For the
 * `storage` event: another tab signed in, refreshed or signed out.
 */
export function dropMemoryAuth() {
  memoryAuth = null;
}

/**
 * Store a session. `persist: true` remembers the device (localStorage);
 * `false` keeps it for this tab's session only (sessionStorage + memory).
 * Either way the previous record in the other storage is removed, so exactly
 * one session is live.
 */
export function setAuth(auth: PincerAuth, opts: { persist?: boolean } = {}) {
  const next: PincerAuth = { ...auth, apiUrl: normalizeApiUrl(auth.apiUrl) };
  const record = JSON.stringify(next);
  const persist = opts.persist ?? true;
  memoryAuth = next;
  try {
    if (persist) {
      localStorage.setItem(AUTH_KEY, record);
      sessionStorage.removeItem(AUTH_KEY);
    } else {
      sessionStorage.setItem(AUTH_KEY, record);
      localStorage.removeItem(AUTH_KEY);
    }
  } catch {
    /* storage unavailable — the in-memory copy still serves this page */
  }
}

export function clearAuth() {
  memoryAuth = null;
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.removeItem(AUTH_KEY);
  } catch {
    /* ignore */
  }
}

/** True when the session is in localStorage (the device is remembered). */
export function isAuthPersisted(): boolean {
  try {
    return localStorage.getItem(AUTH_KEY) !== null;
  } catch {
    return false;
  }
}

export function isConnected(): boolean {
  return getAuth() !== null;
}

export function getUserId(): string {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

export function resetUserId(): string {
  const id = crypto.randomUUID();
  localStorage.setItem(USER_ID_KEY, id);
  return id;
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

/**
 * What a person types is not always a URL `fetch()` can parse.
 *
 * "127.0.0.1:8080" reads as a scheme called `127.0.0.1:` — engines reject it
 * before the request leaves the browser, and WebKit's wording for that ("The
 * string did not match the expected pattern.") tells the owner nothing. So a
 * missing scheme is filled in here, once, for everything that reads the
 * stored credentials: http for loopback and bare IPs, https for a hostname,
 * which is what a tunnel or a deployment will be.
 */
export function normalizeApiUrl(raw: string): string {
  const url = stripTrailingSlash(raw.trim());
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  // A scheme we do not speak is left alone: better a clear failure than a
  // silent rewrite of what someone deliberately configured.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#]|$)/i.test(url);
  return `${local ? "http" : "https"}://${url}`;
}

// ───────────────────── low-level fetch ─────────────────────

/**
 * `X-Pincer-User` is kept for the Notes service (`notes_app`), which rejects a
 * request missing *either* header (ADR 0001). Pincer ignores it under a JWT.
 */
export function authHeaders(auth: PincerAuth): Record<string, string> {
  return {
    Authorization: `Bearer ${auth.token}`,
    "X-Pincer-User": getUserId(),
  };
}

export class PincerError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// ───────────────────── session lifecycle ─────────────────────

type AuthLostListener = () => void;
const authLostListeners = new Set<AuthLostListener>();

/**
 * Subscribe to "the session is over": the server said the token is invalid,
 * or refused to refresh it. Returns the unsubscribe function.
 */
export function onAuthLost(fn: AuthLostListener): () => void {
  authLostListeners.add(fn);
  return () => {
    authLostListeners.delete(fn);
  };
}

function loseSession() {
  clearAuth();
  for (const fn of authLostListeners) {
    try {
      fn();
    } catch {
      /* a listener must never mask the request's own error */
    }
  }
}

export type RefreshResult = "ok" | "rejected" | "unavailable";

async function requestRefresh(staleToken: string): Promise<RefreshResult> {
  // Re-read storage: with "remember this device" another tab may have
  // refreshed while this one waited for the lock, and its pair is the live one.
  const stored = readStoredAuth();
  if (stored) memoryAuth = stored;
  const current = stored ?? memoryAuth;
  if (!current) return "rejected";
  if (current.token !== staleToken) return "ok";

  let res: Response;
  try {
    res = await fetch(`${current.apiUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: current.refreshToken }),
    });
  } catch {
    return "unavailable";
  }
  if (res.ok) {
    try {
      const pair = (await res.json()) as TokenPair;
      setAuth(authFromTokenPair(current.apiUrl, pair), { persist: isAuthPersisted() });
      return "ok";
    } catch {
      return "unavailable";
    }
  }
  // Only an answer about the token itself ends the session. A lockout (429),
  // a 5xx or a dropped connection says nothing about whether it is valid.
  if (res.status >= 400 && res.status < 500 && res.status !== 429) {
    // A newer pair may have been stored while the refresh was in the air (the
    // login form's). That session is alive; only the rejected one is over.
    const latest = readStoredAuth() ?? memoryAuth;
    if (latest && latest.token !== staleToken) return "ok";
    return "rejected";
  }
  return "unavailable";
}

let refreshInFlight: Promise<RefreshResult> | null = null;

/**
 * Trade the refresh token for a new pair, replacing `staleToken`.
 *
 * Single-flight: every caller that arrives while a refresh is running shares
 * that one request — refresh tokens are single-use, so two parallel refreshes
 * would race each other. Across tabs the same guarantee comes from a Web Lock
 * where the browser has one. Does not end the session itself; the caller
 * decides what a "rejected" costs.
 */
export function refreshSession(staleToken: string): Promise<RefreshResult> {
  if (!refreshInFlight) {
    const run = () => requestRefresh(staleToken);
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    const pending: Promise<RefreshResult> = locks?.request
      ? (locks.request(REFRESH_LOCK, run) as Promise<RefreshResult>)
      : run();
    refreshInFlight = pending.finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/**
 * The current session with an access token good for at least `skewMs` more,
 * refreshing ahead of expiry when needed. Null when signed out — including
 * when the refresh was just rejected, which ends the session. A refresh that
 * could not be attempted (offline, 5xx, lockout) keeps the session as it is.
 */
export async function ensureFreshAuth(skewMs = 30_000): Promise<PincerAuth | null> {
  const auth = getAuth();
  if (!auth) return null;
  if (auth.expiresAt - Date.now() > skewMs) return auth;
  const result = await refreshSession(auth.token);
  if (result === "rejected") {
    loseSession();
    return null;
  }
  return getAuth();
}

/** The auth layer's `error` code on a 401, or null for a route's own answer. */
async function authErrorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.clone().json()) as { error?: unknown } | null;
    return typeof body?.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}

/**
 * `fetch` against the connected backend with the session's credentials.
 * `path` is absolute on the API ("/api/voice/calls").
 *
 * Refreshes ahead of expiry; on a 401 `token_expired` refreshes and retries
 * exactly once. The session ends (`onAuthLost`) on `invalid_token`, a rejected
 * refresh, or a second 401 — never on a 401 without an auth code, which is a
 * route's own answer, and never because the refresh could not be reached.
 * The response is returned either way; throws `PincerError` when signed out.
 */
export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const auth = await ensureFreshAuth();
  if (!auth) throw new PincerError("Not connected to Pincer backend", 0);

  const send = (a: PincerAuth) =>
    fetch(`${a.apiUrl}${path}`, {
      ...init,
      headers: { ...authHeaders(a), ...((init.headers as Record<string, string> | undefined) ?? {}) },
    });

  const res = await send(auth);
  if (res.status !== 401) return res;

  const code = await authErrorCode(res);
  if (code === "token_expired") {
    const result = await refreshSession(auth.token);
    if (result === "unavailable") return res;
    const next = result === "ok" ? getAuth() : null;
    if (next) {
      const retried = await send(next);
      if (retried.status !== 401) return retried;
      loseSession();
      return retried;
    }
  } else if (code !== "invalid_token") {
    return res;
  }
  loseSession();
  return res;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authedFetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
      else if (body?.error) detail = body.error;
    } catch {
      /* keep default detail */
    }
    throw new PincerError(detail, res.status);
  }
  return res.json() as Promise<T>;
}

// ───────────────────── chat: non-streaming ─────────────────────

export interface ChatReply {
  reply: string;
  cost_usd?: number;
  model?: string;
}

export async function sendChat(text: string): Promise<ChatReply> {
  return request<ChatReply>("/api/chat/message", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

// ───────────────────── chat: streaming ─────────────────────

export type StreamEvent =
  | { event: "chunk"; data: { delta: string } }
  | { event: "tool"; data: { phase: "start" | "done"; name: string } }
  | {
      event: "approval";
      data: {
        approval_id: string;
        tool: string;
        args?: Record<string, unknown>;
      };
    }
  | { event: "done"; data: { text?: string } }
  | { event: "error"; data: { message: string } };

/**
 * Async generator over the SSE stream from /api/chat/stream.
 *
 * `EventSource` can't set Authorization, so we stream via fetch + a
 * hand-rolled parser for the `event:` / `data:` line protocol.
 */
export async function* streamChat(
  text: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const res = await authedFetch("/api/chat/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ text }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new PincerError(`HTTP ${res.status}`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): StreamEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    const data = JSON.parse(dataLines.join("\n"));
    return { event, data } as StreamEvent;
  } catch {
    return null;
  }
}

// ───────────────────── tool approvals ─────────────────────

// Resolve a pending approval the backend asked about via an SSE `approval`
// event. The agent's `await request_approval(...)` future on the server
// is keyed by `approval_id`; this POST resolves it and lets the streaming
// turn continue.
export async function respondApproval(
  approvalId: string,
  approved: boolean,
): Promise<void> {
  await request<{ ok: true }>("/api/chat/approval", {
    method: "POST",
    body: JSON.stringify({ approval_id: approvalId, approved }),
  });
}

// ───────────────────── conversation history ─────────────────────

export interface PincerMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  tool_name?: string | null;
  tool_input?: unknown;
}

interface ConversationsListItem {
  id: string;
  user_id: string;
  channel: string;
  updated_at: string;
}

interface ConversationDetail {
  id: string;
  messages: PincerMessage[];
}

/**
 * Fetch the most recent "web" conversation of the signed-in identity.
 * Returns null if none exists yet.
 */
export async function fetchLatestConversation(): Promise<PincerMessage[] | null> {
  const userId = getAuth()?.userId;
  if (!userId) return null;
  const list = await request<{ conversations: ConversationsListItem[] }>(
    `/api/conversations?user_id=${encodeURIComponent(userId)}&channel=web&limit=1`,
  );
  const first = list.conversations?.[0];
  if (!first) return null;
  const detail = await request<ConversationDetail>(`/api/conversations/${first.id}`);
  return detail.messages ?? [];
}
