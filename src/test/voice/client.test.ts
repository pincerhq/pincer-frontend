/**
 * FE0 §6 — the API client: auth header, tenant header, 401 contract, 422
 * field mapping, 204 handling, and the SPA-fallthrough-as-404 rule — plus the
 * session lifecycle underneath it: refresh ahead of expiry, one retry on
 * `token_expired`, and what does and does not end a session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAuth, clearAuth, getAuth, isAuthPersisted, type PincerAuth } from "@/lib/pincerClient";
import { ApiError, api, normalizeErrorBody, onUnauthorized, publicRequest, request, qs } from "@/lib/api/client";
import { setTenantId } from "@/lib/api/tenant";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const session = (over: Partial<PincerAuth> = {}): PincerAuth => ({
  apiUrl: "http://api.test",
  token: "secret-token",
  refreshToken: "refresh-1",
  expiresAt: Date.now() + 10 * 60_000,
  userId: "alice",
  ...over,
});

const pair = (n: number) => ({
  access_token: `access-${n}`,
  refresh_token: `refresh-${n}`,
  token_type: "bearer",
  expires_in: 1800,
  pincer_user_id: "alice",
});

const authError = (code: string) => jsonResponse({ error: code, detail: code }, { status: 401 });
const bearerOf = (init: RequestInit | undefined) => (init?.headers as Record<string, string>).Authorization;

describe("api client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    setAuth(session());
    setTenantId(null);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    clearAuth();
    vi.unstubAllGlobals();
  });

  it("sends the bearer token and the per-browser user id, never a tenant header without a tenant", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await api.get("/api/voice/status");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/voice/status");
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-token");
    expect(headers["X-Pincer-User"]).toBeTruthy();
    expect(headers["X-Tenant-Id"]).toBeUndefined();
  });

  it("adds X-Tenant-Id only when the session has a tenant", async () => {
    setTenantId("kanzlei-42");
    fetchMock.mockResolvedValue(jsonResponse({}));
    await api.get("/api/voice/status");
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["X-Tenant-Id"]).toBe("kanzlei-42");
  });

  it("JSON-encodes bodies for post/put/patch and uses the verb", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 1 }, { status: 201 }));
    await api.post("/api/voice/calls", { to: "+49", task: "x" });
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ to: "+49", task: "x" }));
  });

  it("returns undefined on 204 instead of failing to parse", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.del("/api/voice/do-not-call/%2B49")).resolves.toBeUndefined();
  });

  it("ends the session on invalid_token without trying to refresh, and still throws", async () => {
    fetchMock.mockImplementation(async () => authError("invalid_token"));
    const listener = vi.fn();
    const off = onUnauthorized(listener);
    await expect(request("/api/voice/status")).rejects.toMatchObject({ status: 401, code: "invalid_token" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAuth()).toBeNull();
    expect(localStorage.getItem("pincer.web.auth")).toBeNull();
    off();
    setAuth(session());
    await expect(request("/api/voice/status")).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("treats a 401 without an auth code as the route's own answer", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ detail: "No authenticated identity" }, { status: 401 }));
    const listener = vi.fn();
    const off = onUnauthorized(listener);
    await expect(request("/api/voice/status")).rejects.toMatchObject({ status: 401, message: "No authenticated identity" });
    expect(listener).not.toHaveBeenCalled();
    expect(getAuth()?.token).toBe("secret-token");
    off();
  });

  it("refreshes once on token_expired and retries the request once with the new token", async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/api/auth/refresh")) return jsonResponse(pair(2));
      return bearerOf(init) === "Bearer access-2" ? jsonResponse({ ok: true }) : authError("token_expired");
    });
    await expect(api.get("/api/voice/status")).resolves.toEqual({ ok: true });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      "http://api.test/api/voice/status",
      "http://api.test/api/auth/refresh",
      "http://api.test/api/voice/status",
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ refresh_token: "refresh-1" });
    // The refresh is public: it must not carry the token it replaces.
    expect((fetchMock.mock.calls[1]![1]!.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(getAuth()).toMatchObject({ token: "access-2", refreshToken: "refresh-2", userId: "alice" });
    // Same storage as before: a remembered device stays remembered.
    expect(isAuthPersisted()).toBe(true);
  });

  it("shares one refresh between concurrent requests", async () => {
    let refreshes = 0;
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/api/auth/refresh")) {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 5));
        return jsonResponse(pair(2));
      }
      return bearerOf(init) === "Bearer access-2" ? jsonResponse({ ok: true }) : authError("token_expired");
    });
    const results = await Promise.all([api.get("/api/a"), api.get("/api/b"), api.get("/api/c")]);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshes).toBe(1);
  });

  it("ends the session when the refresh token is rejected", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith("/api/auth/refresh") ? authError("invalid_token") : authError("token_expired"),
    );
    const listener = vi.fn();
    const off = onUnauthorized(listener);
    await expect(api.get("/api/voice/status")).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getAuth()).toBeNull();
    expect(localStorage.getItem("pincer.web.auth")).toBeNull();
    expect(sessionStorage.getItem("pincer.web.auth")).toBeNull();
    off();
  });

  it("ends the session when the retried request is refused too", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith("/api/auth/refresh") ? jsonResponse(pair(2)) : authError("token_expired"),
    );
    const listener = vi.fn();
    const off = onUnauthorized(listener);
    await expect(api.get("/api/voice/status")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it.each([
    ["a lockout", async () => jsonResponse({ error: "locked_out" }, { status: 429 })],
    ["a server error", async () => jsonResponse({ detail: "boom" }, { status: 503 })],
    ["a dropped connection", async () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("keeps the session when the refresh could not be done: %s", async (_name, refreshAnswer) => {
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith("/api/auth/refresh") ? refreshAnswer() : authError("token_expired"),
    );
    const listener = vi.fn();
    const off = onUnauthorized(listener);
    await expect(api.get("/api/voice/status")).rejects.toMatchObject({ status: 401, code: "token_expired" });
    expect(listener).not.toHaveBeenCalled();
    expect(getAuth()).toMatchObject({ token: "secret-token", refreshToken: "refresh-1" });
    off();
  });

  it("refreshes ahead of expiry instead of sending a token about to die", async () => {
    setAuth(session({ expiresAt: Date.now() + 5_000 }), { persist: false });
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith("/api/auth/refresh") ? jsonResponse(pair(2)) : jsonResponse({ ok: true }),
    );
    await api.get("/api/voice/status");
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      "http://api.test/api/auth/refresh",
      "http://api.test/api/voice/status",
    ]);
    expect(bearerOf(fetchMock.mock.calls[1]![1])).toBe("Bearer access-2");
    expect(isAuthPersisted()).toBe(false);
    expect(sessionStorage.getItem("pincer.web.auth")).toContain("access-2");
  });

  it("uses the pair another tab already stored instead of refreshing again", async () => {
    setAuth(session({ expiresAt: Date.now() + 5_000 }));
    // What the other tab wrote; this tab's memory copy still holds the old pair.
    localStorage.setItem("pincer.web.auth", JSON.stringify(session({ token: "access-9", refreshToken: "refresh-9" })));
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
    await api.get("/api/voice/status");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bearerOf(fetchMock.mock.calls[0]![1])).toBe("Bearer access-9");
  });

  it("drops a stored record from before per-identity sign-in", () => {
    clearAuth();
    localStorage.setItem("pincer.web.auth", JSON.stringify({ apiUrl: "http://api.test", token: "shared-token" }));
    sessionStorage.setItem("pincer.web.auth", JSON.stringify({ apiUrl: "http://api.test", token: "shared-token" }));
    expect(getAuth()).toBeNull();
    expect(localStorage.getItem("pincer.web.auth")).toBeNull();
    expect(sessionStorage.getItem("pincer.web.auth")).toBeNull();
  });

  it("maps FastAPI 422 bodies to per-field messages and a verbatim joined detail", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          detail: [
            { loc: ["body", "phone_number"], msg: "Ungültige Rufnummer", type: "value_error" },
            { loc: ["body", "hours", "mon", 0], msg: "Endzeit liegt vor Startzeit", type: "value_error" },
          ],
        },
        { status: 422 },
      ),
    );
    let caught: ApiError | null = null;
    try {
      await api.post("/api/voice/receptionist/profile", {});
    } catch (e) {
      caught = e as ApiError;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught!.status).toBe(422);
    expect(caught!.detail).toBe("Ungültige Rufnummer · Endzeit liegt vor Startzeit");
    expect(caught!.fields).toEqual({
      phone_number: "Ungültige Rufnummer",
      "hours.mon.0": "Endzeit liegt vor Startzeit",
    });
  });

  it("treats an HTML answer (SPA fallthrough) as a missing endpoint", async () => {
    fetchMock.mockResolvedValue(new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(api.get("/api/voice/nope")).rejects.toMatchObject({ status: 404 });
  });

  it("names the address when the request never leaves the browser", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.get("/api/voice/status")).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining("http://api.test/api/voice/status"),
    });
  });

  it("refuses to call without a connection", async () => {
    clearAuth();
    await expect(api.get("/api/voice/status")).rejects.toMatchObject({ status: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("normalizeErrorBody", () => {
  it("keeps a string detail verbatim", () => {
    expect(normalizeErrorBody({ detail: "Nummer steht auf der Sperrliste" }, 409)).toEqual({
      detail: "Nummer steht auf der Sperrliste",
    });
  });
  it("falls back to the status when the body is not JSON-shaped", () => {
    expect(normalizeErrorBody(null, 502)).toEqual({ detail: "HTTP 502" });
    expect(normalizeErrorBody("oops", 500)).toEqual({ detail: "HTTP 500" });
  });
  it("accepts the legacy {error} shape", () => {
    expect(normalizeErrorBody({ error: "boom" }, 500).detail).toBe("boom");
  });
});

describe("publicRequest", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends no credentials and surfaces the auth code and a readable Retry-After", async () => {
    setAuth(session());
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "locked_out", detail: "Too many failed authentication attempts" }, { status: 429, headers: { "content-type": "application/json", "Retry-After": "120" } }),
    );
    await expect(publicRequest("http://api.test/", "/api/auth/login", { method: "POST" })).rejects.toMatchObject({
      status: 429,
      code: "locked_out",
      retryAfter: 120,
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/auth/login");
    expect((init!.headers as Record<string, string>).Authorization).toBeUndefined();
    clearAuth();
  });
});

describe("qs", () => {
  it("drops empty values and encodes the rest", () => {
    expect(qs({ limit: 200, offset: 0, unread: true, q: "", nothing: undefined })).toBe("?limit=200&offset=0&unread=true");
    expect(qs({})).toBe("");
  });
});
