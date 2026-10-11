import type { Page } from "@playwright/test";

/**
 * The owner app talks to `auth.apiUrl + path`. For backend-free e2e the
 * stored session points at MOCK_API and Playwright answers every `/api/*`
 * call from the fixtures below — deterministic, and exactly the shapes of the
 * pinned contract plus the FE1 asks.
 *
 * The login form has no server field: it posts to the build's
 * `VITE_PINCER_API_URL`, else the page origin. So `/api/*` is answered on
 * *any* origin, and a sign-in through the form works whatever the dev server
 * was started with.
 */
export const MOCK_API = "http://mock.pincer.local";

/** The one account the mocked `/api/auth/login` knows. */
export const E2E_USER = { name: "alice", email: "alice@example.com", password: "correct horse battery" };

const tokenPair = (n: number | string) => ({
  access_token: `e2e-access-${n}`,
  refresh_token: `e2e-refresh-${n}`,
  token_type: "bearer",
  expires_in: 1800,
  pincer_user_id: E2E_USER.name,
});

const authError = (code: string, status = 401) => ({
  status,
  contentType: "application/json",
  headers: { "access-control-allow-origin": "*" },
  body: JSON.stringify({ error: code, detail: code }),
});

const NOW = new Date();
const iso = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

export const FIXTURES: Record<string, unknown> = {
  "/api/health": { status: "ok", version: "0.8.0" },
  "/api/voice/status": {
    enabled: true,
    engine: "conversation_relay",
    language: "de",
    consent_mode: "announce",
    outbound_enabled: true,
    voice_configured: true,
    webhook_base_configured: true,
    active_call_count: 1,
    listen_in_enabled: false,
    telephony: { mode: "forwarding", number_masked: "+49 5223 ••• 4521", sip_registered: null },
  },
  "/api/voice/active": [
    {
      call_sid: "CA-live-1",
      direction: "inbound",
      caller_number: "+4917112344521",
      target_number: "+495223000000",
      target_name: "",
      purpose: "Terminanfrage Jahresabschluss",
      engine: "conversation_relay",
      duration_seconds: 42,
      started_at: iso(0.7),
    },
  ],
  "/api/voice/calls": [
    { call_sid: "CA-1", direction: "inbound", status: "completed", from_number: "+4917112344521", to_number: "+495223000000", started_at: iso(30), ended_at: iso(28), duration_seconds: 120, inbound_intent: "appointment", appointment: { status: "calendar_created" } },
    { call_sid: "CA-2", direction: "inbound", status: "no-answer", from_number: "+4915112345678", to_number: "+495223000000", started_at: iso(90), ended_at: null, duration_seconds: 0, inbound_intent: "human", failure_code: "transfer_failed", failure_description: "Niemand hat abgenommen" },
    { call_sid: "CA-3", direction: "outbound", status: "completed", from_number: "+495223000000", to_number: "+4916012345678", started_at: iso(200), ended_at: iso(195), duration_seconds: 300 },
  ],
  // FE10: every spec can open a call detail; the GA scenario, roles, privacy-network and mobile specs rely on it.
  "/api/voice/calls/CA-1": {
    call_sid: "CA-1", direction: "inbound", status: "completed", from_number: "+4917112344521", to_number: "+495223000000", started_at: iso(30), ended_at: iso(28), duration_seconds: 120, inbound_intent: "appointment", language: "de",
    appointment: { status: "calendar_created", agreed_datetime: iso(-1440), duration_minutes: 30, calendar_event_link: null, retry_count: 0 },
    transcript: [{ speaker: "assistant", text: "Guten Tag, hier ist der digitale Assistent von Kanzlei Muster.", confidence: 1, state: "", timestamp: iso(30) }, { speaker: "caller", text: "Ich hätte gern einen Termin.", confidence: 0.97, state: "", timestamp: iso(29.8) }],
    actions: [{ action_type: "tool_execute", tool_name: "google__create_event", input_summary: "", output_summary: "Termin eingetragen", user_confirmed: null, timestamp: iso(29), tier: "W", approval_mode: "verbal", deny_reason: "", duration_ms: 420 }],
    tool_timeline: [{ tool: "google__create_event", tier: "W", outcome: "ok", ms: 420, approval: "verbal", reason: "", timestamp: iso(29) }],
  },
  "/api/voice/messages": [
    { id: 7, call_sid: "CA-4", caller_name: "Frau Müller", caller_name_unverified: false, callback_number: "+4917212345678", callback_unverified: false, matter: "Bitte um Rückruf wegen Steuerbescheid", urgent: true, created_at: iso(15), delivered_to_owner_at: null },
  ],
  "/api/voice/approvals/pending": [],
  "/api/voice/approvals": [],
  "/api/voice/threads": [],
  "/api/doctor": { score: 95, passed: true, warnings: 2, critical: 0, checks: [] },
  "/api/costs/today": { date: "2026-09-07", total_usd: 1.23, request_count: 14 },
  "/api/integrations": { integrations: [{ slug: "google", name: "Google Workspace", active: true }] },
  "/api/identity/me": { pincer_user_id: E2E_USER.name, display_name: "Alice Owner", email: E2E_USER.email, auth_method: "session" },
};

export async function mockBackend(page: Page, overrides: Record<string, unknown | null> = {}) {
  let issued = 1;
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  await page.route(
    (url) => url.origin === MOCK_API || url.pathname.startsWith("/api/"),
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      if (path === "/api/approvals/stream") return route.abort();
      if (!(path in overrides)) {
        if (path === "/api/auth/login") {
          const body = request.postDataJSON() as { identifier?: string; password?: string } | null;
          const known = [E2E_USER.name, E2E_USER.email].includes((body?.identifier ?? "").toLowerCase());
          if (!known || body?.password !== E2E_USER.password) return route.fulfill(authError("invalid_credentials"));
          return json(tokenPair(issued++));
        }
        if (path === "/api/auth/refresh") return json(tokenPair(issued++));
        if (path === "/api/auth/logout") return route.fulfill({ status: 204, headers: cors });
      }
      const body = path in overrides ? overrides[path] : FIXTURES[path];
      if (body === null) return json({ detail: "Not found" }, 404);
      if (body === undefined) return json({ detail: `no fixture for ${path}` }, 404);
      return json(body);
    },
  );
}

/** Start with an already-signed-in owner session (the sign-in form has its own tests). */
export async function loginAsOwner(page: Page, over: { expiresInMs?: number } = {}) {
  await page.addInitScript(
    ({ apiUrl, userId, expiresInMs }: { apiUrl: string; userId: string; expiresInMs: number }) => {
      // Once per tab: a test that signs out must stay signed out on the next load.
      if (sessionStorage.getItem("e2e.seeded")) return;
      sessionStorage.setItem("e2e.seeded", "1");
      sessionStorage.setItem(
        "pincer.web.auth",
        JSON.stringify({ apiUrl, token: "e2e-access-0", refreshToken: "e2e-refresh-0", expiresAt: Date.now() + expiresInMs, userId }),
      );
    },
    { apiUrl: MOCK_API, userId: E2E_USER.name, expiresInMs: over.expiresInMs ?? 30 * 60_000 },
  );
}

/** Fill and submit either sign-in form. The labels differ by page and language. */
export async function signIn(page: Page, labels: { identifier: string; password: string; submit: string }, identifier: string, password: string) {
  await page.getByLabel(labels.identifier).fill(identifier);
  await page.getByLabel(labels.password, { exact: true }).fill(password);
  await page.getByRole("button", { name: labels.submit, exact: true }).click();
}

export const OWNER_LOGIN_LABELS = { identifier: "Name oder E-Mail", password: "Passwort", submit: "Anmelden" };
export const PLATFORM_LOGIN_LABELS = { identifier: "Name or email", password: "Password", submit: "Sign in" };
