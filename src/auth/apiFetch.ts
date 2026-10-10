/**
 * Authenticated fetch for the standalone Notes service (`notes_app`).
 *
 * Sprint 0 §3.2 specified an OIDC wrapper; **ADR 0001 superseded that** — no
 * Zitadel. What is sent is the signed-in Pincer session's access token plus the
 * per-browser UUID as `X-Pincer-User`. The service rejects a request missing
 * *either* header, so both are always set together.
 *
 * The token is read through `pincerClient` (`ensureFreshAuth`, so it is never
 * sent already expired) instead of re-reading `pincer.web.auth` here — one
 * place knows the storage keys. A 401 from the Notes service does not end the
 * Pincer session; Notes shows its own dialog.
 *
 * Open question, recorded because it is easy to forget: ADR 0001 was written
 * for Pincer's *shared* token. Whether `notes_app` accepts a per-identity
 * Pincer JWT is for its owner to confirm; until then `VITE_NOTES_TOKEN` is the
 * way to give it a credential it knows. `X-Pincer-User` is still
 * client-asserted. Pilot-grade, not §203-grade (ADR 0001).
 */

import { ensureFreshAuth, getAuth, getUserId } from '@/lib/pincerClient';

const RAW_API_URL = (import.meta.env.VITE_NOTES_API_URL as string | undefined)?.trim();

/**
 * Whether a base URL was configured at all.
 *
 * An unset `VITE_NOTES_API_URL` is not the same as "same origin": it means the
 * build was never pointed at a Notes service, and every request would go to the
 * frontend's own origin and come back as the SPA's HTML. That produces a
 * baffling JSON parse error, so it is reported as the configuration mistake it
 * is. To deploy behind a reverse proxy on the same origin, set the variable to
 * `/` explicitly.
 */
export const NOTES_API_CONFIGURED = Boolean(RAW_API_URL);

/** `VITE_NOTES_API_URL` with trailing slashes stripped. */
export const NOTES_API_URL = (RAW_API_URL ?? '').replace(/\/+$/, '');

/**
 * A token dedicated to the Notes service, for deployments where it does not
 * share Pincer's. Falls back to the Pincer token, which is the normal case.
 */
const NOTES_TOKEN = (import.meta.env.VITE_NOTES_TOKEN as string | undefined)?.trim();

export class NotAuthenticatedError extends Error {
  constructor() {
    super(
      'Not connected to the Notes backend. Sign in again or set VITE_NOTES_TOKEN.',
    );
  }
}

/** Why the Notes API is unreachable, or null when it is reachable. */
export function notesApiBlocker(): string | null {
  if (!NOTES_API_CONFIGURED) {
    return 'VITE_NOTES_API_URL is not set, so this build has no Notes backend to talk to. Set it to the service URL (dev: http://localhost:8000) and reload.';
  }
  if (!NOTES_TOKEN && !getAuth()) {
    return 'Not connected to the Notes backend. Sign in again, or set VITE_NOTES_TOKEN for this build.';
  }
  return null;
}

/**
 * Headers for a Notes request, or throws if no credential is reachable.
 *
 * Only ever `Authorization` and `X-Pincer-User`: the service's CORS policy
 * allows exactly `Authorization, Content-Type, X-Pincer-User, X-Request-Id`, so
 * any other custom header fails the preflight before the request is sent. That
 * is why the dev-only `X-Debug-User` path is not offered here.
 */
export function notesAuthHeaders(): Record<string, string> {
  if (NOTES_TOKEN) {
    return {
      Authorization: `Bearer ${NOTES_TOKEN}`,
      'X-Pincer-User': getUserId(),
    };
  }
  const auth = getAuth();
  if (!auth) throw new NotAuthenticatedError();
  return authHeadersFor(auth);
}

/** True when a Notes request can be made at all — used to render a connect prompt. */
export function canReachNotesApi(): boolean {
  return notesApiBlocker() === null;
}

function authHeadersFor(auth: { token: string }): Record<string, string> {
  return {
    Authorization: `Bearer ${auth.token}`,
    'X-Pincer-User': getUserId(),
  };
}

/**
 * `fetch` with the Notes credential attached. `url` may be absolute or a
 * service-relative path (`/v1/notes`), which is prefixed with
 * `VITE_NOTES_API_URL`.
 */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const target = /^https?:\/\//.test(url) ? url : `${NOTES_API_URL}${url}`;
  // An access token lives for minutes: renew it before it is sent, since the
  // Notes service's flat 401 could not be told apart from a real refusal.
  if (!NOTES_TOKEN) await ensureFreshAuth();
  const headers = { ...notesAuthHeaders(), ...(init.headers ?? {}) } as Record<string, string>;
  assertCredentialHeaders(headers, target);
  countForBudget(init.method ?? 'GET', url);
  return fetch(target, { ...init, headers });
}

/**
 * The service allows sixty requests per user per minute and answers 429 past
 * that (`USER_PER_MINUTE`, Sprint 5 §4). A render loop that fires two PATCHes
 * per turn crosses that in seconds, and the symptom the developer sees is not
 * "the app is looping" but "the app is rate limited" — which sends them looking
 * at the backend. So the budget is counted here, and the loop is named where it
 * happens, before the server has to say it.
 *
 * Dev only: `import.meta.env.DEV` folds the whole thing away in a real build.
 */
const BUDGET_PER_MINUTE = 60;
const recentRequests: Array<{ at: number; label: string }> = [];
let budgetWarned = false;

function countForBudget(method: string, url: string): void {
  if (!import.meta.env.DEV) return;
  const now = Date.now();
  while (recentRequests.length > 0 && now - recentRequests[0].at > 60_000) recentRequests.shift();
  recentRequests.push({ at: now, label: `${method.toUpperCase()} ${url.split('?')[0]}` });

  if (recentRequests.length <= BUDGET_PER_MINUTE) {
    budgetWarned = false;
    return;
  }
  if (budgetWarned) return;
  budgetWarned = true;

  const byLabel = new Map<string, number>();
  for (const entry of recentRequests) byLabel.set(entry.label, (byLabel.get(entry.label) ?? 0) + 1);
  const worst = [...byLabel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.error(
    `[notes] ${recentRequests.length} requests in the last minute — past the service's ` +
      `${BUDGET_PER_MINUTE}/min per-user limit, so the next ones will come back 429. ` +
      'This is almost always an effect whose dependencies change when its own request lands. ' +
      `Loudest: ${worst.map(([label, n]) => `${label} ×${n}`).join(', ')}`,
  );
}

/**
 * Dev-only guard against ADR 0001's sharpest edge.
 *
 * The service rejects a request missing *either* header, and it does so with a
 * flat 401 that names neither — so a missing `X-Pincer-User` looks exactly like
 * an expired token, and every request in the app fails identically and
 * opaquely. Naming the missing header once, loudly, at the point of the call is
 * the difference between a five-minute fix and an afternoon.
 *
 * Stripped from production builds: it would only ever fire on a bug that dev
 * already caught, and `import.meta.env.DEV` folds the whole thing away.
 */
function assertCredentialHeaders(headers: Record<string, string>, target: string): void {
  if (!import.meta.env.DEV) return;
  const missing = ['Authorization', 'X-Pincer-User'].filter((name) => !headers[name]);
  if (missing.length === 0) return;
  console.error(
    `[notes] request to ${target} is missing ${missing.join(' and ')}. ` +
      'The Notes service requires both (ADR 0001) and will answer 401 without saying which. ' +
      'Check the Pincer session in storage (`pincer.web.auth`) or VITE_NOTES_TOKEN.',
  );
}
