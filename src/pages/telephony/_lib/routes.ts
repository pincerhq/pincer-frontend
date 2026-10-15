/**
 * Route constants for the owner app (FE-BINDING: "Route constants").
 *
 * The owner app lives inside the voice app: every Block I route is mounted
 * under `/telephony`, slugs are English, labels are German (FE0 decision 4).
 * `App.tsx` registers `TELEPHONY_STATIC_PATHS`; `TelephonyHome` switches on
 * the pathname. Nothing personal ever goes into a path (rule 5) — call SIDs
 * and thread ids are opaque backend identifiers, not phone numbers.
 */
export const TELEPHONY_BASE = "/telephony";

const p = (sub: string) => `${TELEPHONY_BASE}${sub}`;

export const ROUTES = {
  HOME: TELEPHONY_BASE,
  /** Übersicht is the home screen; `/telephony/overview` redirects here. */
  OVERVIEW: TELEPHONY_BASE,
  OVERVIEW_ALIAS: p("/overview"),
  LOGIN: p("/login"),
  CALLS: p("/calls"),
  /** The operator-flavoured voice page (threads, latency, cost) — "Erweitert". */
  CALLS_OPS: p("/calls/ops"),
  CALLS_LIVE: p("/calls/live"),
  CALLS_PENDING: p("/calls/pending-approval"),
  CALL: (callSid: string) => p(`/calls/${encodeURIComponent(callSid)}`),
  THREAD: (threadId: string) => p(`/threads/${encodeURIComponent(threadId)}`),
  MESSAGES: p("/messages"),
  PLANNED: p("/planned"),
  SETTINGS: p("/settings"),
  POLICIES: p("/policies"),
} as const;



/** Every static (non-parameterised) path App.tsx must register. */
export const TELEPHONY_STATIC_PATHS: readonly string[] = [
  ROUTES.HOME,
  ROUTES.OVERVIEW_ALIAS,
  ROUTES.CALLS,
  ROUTES.CALLS_OPS,
  ROUTES.CALLS_LIVE,
  ROUTES.CALLS_PENDING,
  ROUTES.MESSAGES,
  ROUTES.PLANNED,
  ROUTES.POLICIES,
  ROUTES.SETTINGS,
];

