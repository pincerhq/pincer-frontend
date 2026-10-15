/**
 * FE1 §7 — session store: password sign-in, remember-device storage, the
 * identity from /api/identity/me, logout, session loss, and `can()` gating.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuth, getAuth, isAuthPersisted, setAuth } from "@/lib/pincerClient";
import { queryClient } from "@/lib/queryClient";
import { ApiError } from "@/lib/api/client";
import { canRole, defaultApiUrl, resolveReturnTo, safeReturnTo, useSession } from "@/stores/session";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const PAIR = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  token_type: "bearer",
  expires_in: 1800,
  pincer_user_id: "alice",
};
const ME = { pincer_user_id: "alice", display_name: "Alice", email: "alice@example.com", auth_method: "session" };

/** Answers by path; anything not listed is a 404. A fresh Response per call. */
function backend(routes: Record<string, () => Response | Promise<Response>>) {
  return async (url: RequestInfo | URL) => {
    const path = new URL(String(url)).pathname;
    const answer = routes[path];
    return answer ? answer() : json({ detail: "Not found" }, 404);
  };
}

describe("login", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    clearAuth();
    localStorage.clear();
    sessionStorage.clear();
    useSession.getState().refresh();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearAuth();
  });

  it("posts name/email + password and keeps the session in sessionStorage by default", async () => {
    fetchMock.mockImplementation(backend({ "/api/auth/login": () => json(PAIR), "/api/identity/me": () => json(ME) }));
    await useSession.getState().login({ identifier: "  Alice@Example.com ", password: " pw with spaces ", apiUrl: "http://api.test" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/auth/login");
    // The identifier is trimmed; a password is sent exactly as typed.
    expect(JSON.parse(init!.body as string)).toEqual({ identifier: "Alice@Example.com", password: " pw with spaces " });
    expect((init!.headers as Record<string, string>).Authorization).toBeUndefined();

    expect(getAuth()).toMatchObject({ apiUrl: "http://api.test", token: "access-1", refreshToken: "refresh-1", userId: "alice" });
    expect(getAuth()!.expiresAt).toBeGreaterThan(Date.now() + 1700_000);
    expect(isAuthPersisted()).toBe(false);
    expect(sessionStorage.getItem("pincer.web.auth")).toContain("refresh-1");
    expect(localStorage.getItem("pincer.web.auth")).toBeNull();
    expect(useSession.getState().connected).toBe(true);
    expect(useSession.getState().role).toBe("owner");
    // The old browser-side flag is gone for good.
    expect(sessionStorage.getItem("isAuthenticated")).toBeNull();
  });

  it("keeps the session in localStorage when the device is remembered", async () => {
    fetchMock.mockImplementation(backend({ "/api/auth/login": () => json(PAIR), "/api/identity/me": () => json(ME) }));
    await useSession.getState().login({ identifier: "alice", password: "pw", apiUrl: "http://api.test", remember: true });
    expect(isAuthPersisted()).toBe(true);
    expect(localStorage.getItem("pincer.web.auth")).toContain("access-1");
    expect(sessionStorage.getItem("pincer.web.auth")).toBeNull();
    expect(useSession.getState().remembered).toBe(true);
  });

  it("loads who is signed in from /api/identity/me", async () => {
    fetchMock.mockImplementation(backend({ "/api/auth/login": () => json(PAIR), "/api/identity/me": () => json(ME) }));
    await useSession.getState().login({ identifier: "alice", password: "pw", apiUrl: "http://api.test" });
    expect(useSession.getState().identity).toEqual({ id: "alice", displayName: "Alice", email: "alice@example.com" });
    const me = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/api/identity/me"))!;
    expect((me[1]!.headers as Record<string, string>).Authorization).toBe("Bearer access-1");
  });

  it("still signs in when /api/identity/me fails", async () => {
    fetchMock.mockImplementation(backend({ "/api/auth/login": () => json(PAIR), "/api/identity/me": () => json({ detail: "boom" }, 500) }));
    await useSession.getState().login({ identifier: "alice", password: "pw", apiUrl: "http://api.test" });
    expect(useSession.getState().connected).toBe(true);
    expect(useSession.getState().identity).toEqual({ id: "alice", displayName: null, email: null });
  });

  it.each([
    ["wrong credentials", 401, { error: "invalid_credentials", detail: "Invalid credentials" }, "invalid_credentials"],
    ["a lockout", 429, { error: "locked_out", detail: "Too many failed authentication attempts" }, "locked_out"],
  ])("stores nothing on %s", async (_name, status, body, code) => {
    fetchMock.mockImplementation(backend({ "/api/auth/login": () => json(body, status) }));
    await expect(useSession.getState().login({ identifier: "alice", password: "bad", apiUrl: "http://api.test" })).rejects.toMatchObject({ status, code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAuth()).toBeNull();
    expect(sessionStorage.getItem("pincer.web.auth")).toBeNull();
    expect(localStorage.getItem("pincer.web.auth")).toBeNull();
    expect(useSession.getState().connected).toBe(false);
    expect(useSession.getState().lastDisconnect).toBeNull();
  });

  it("logs out when the session is lost on a later request and remembers where to return", async () => {
    fetchMock.mockImplementation(backend({ "/api/auth/login": () => json(PAIR), "/api/identity/me": () => json(ME) }));
    await useSession.getState().login({ identifier: "alice", password: "pw", apiUrl: "http://api.test", remember: true });
    window.history.pushState({}, "", "/telephony/calls?view=table");
    fetchMock.mockImplementation(async () => json({ error: "invalid_token", detail: "Invalid token" }, 401));
    const { request } = await import("@/lib/api/client");
    await expect(request("/api/voice/calls")).rejects.toBeInstanceOf(ApiError);
    const s = useSession.getState();
    expect(s.connected).toBe(false);
    expect(s.lastDisconnect).toBe("unauthorized");
    expect(s.returnTo).toBe("/telephony/calls?view=table");
    expect(s.identity).toBeNull();
    expect(getAuth()).toBeNull();
  });

  it("logout clears both storages and ends the session on the server", async () => {
    fetchMock.mockImplementation(backend({ "/api/auth/login": () => json(PAIR), "/api/identity/me": () => json(ME), "/api/auth/logout": () => new Response(null, { status: 204 }) }));
    await useSession.getState().login({ identifier: "alice", password: "pw", apiUrl: "http://api.test", remember: true });
    useSession.getState().logout();
    // Synchronous: the screen changes without waiting for the server.
    expect(getAuth()).toBeNull();
    expect(localStorage.getItem("pincer.web.auth")).toBeNull();
    expect(sessionStorage.getItem("pincer.web.auth")).toBeNull();
    expect(useSession.getState().role).toBeNull();
    expect(useSession.getState().identity).toBeNull();
    const call = fetchMock.mock.calls.find((c) => String(c[0]) === "http://api.test/api/auth/logout")!;
    expect(call[1]!.method).toBe("POST");
    expect((call[1]!.headers as Record<string, string>).Authorization).toBe("Bearer access-1");
  });

  it("logout refreshes an expired access token first, so the server-side logout is not refused", async () => {
    fetchMock.mockImplementation(
      backend({
        "/api/auth/login": () => json(PAIR),
        "/api/identity/me": () => json(ME),
        "/api/auth/refresh": () => json({ ...PAIR, access_token: "access-2", refresh_token: "refresh-2" }),
        "/api/auth/logout": () => new Response(null, { status: 204 }),
      }),
    );
    await useSession.getState().login({ identifier: "alice", password: "pw", apiUrl: "http://api.test" });
    // Idle for longer than the access token lives.
    setAuth({ ...getAuth()!, expiresAt: Date.now() - 60_000 }, { persist: false });
    fetchMock.mockClear();
    useSession.getState().logout();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [refresh, logout] = fetchMock.mock.calls;
    expect(String(refresh[0])).toBe("http://api.test/api/auth/refresh");
    expect(JSON.parse(refresh[1]!.body as string)).toEqual({ refresh_token: "refresh-1" });
    expect(String(logout[0])).toBe("http://api.test/api/auth/logout");
    expect((logout[1]!.headers as Record<string, string>).Authorization).toBe("Bearer access-2");
    // The fresh pair is used to end the session, never stored.
    expect(getAuth()).toBeNull();
    expect(sessionStorage.getItem("pincer.web.auth")).toBeNull();
  });

  it("drops the previous identity's cached server state on logout, session loss and a cross-tab switch", async () => {
    fetchMock.mockImplementation(backend({ "/api/auth/login": () => json(PAIR), "/api/identity/me": () => json(ME), "/api/auth/logout": () => new Response(null, { status: 204 }) }));
    const signInWithCache = async () => {
      await useSession.getState().login({ identifier: "alice", password: "pw", apiUrl: "http://api.test", remember: true });
      queryClient.setQueryData(["voice", "calls"], [{ call_sid: "CA-1" }]);
    };
    await signInWithCache();
    useSession.getState().logout();
    expect(queryClient.getQueryData(["voice", "calls"])).toBeUndefined();

    await signInWithCache();
    useSession.getState().disconnect("unauthorized");
    expect(queryClient.getQueryData(["voice", "calls"])).toBeUndefined();

    await signInWithCache();
    // Another tab signed in as someone else.
    localStorage.setItem("pincer.web.auth", JSON.stringify({ ...getAuth()!, token: "bob-access", refreshToken: "bob-refresh", userId: "bob" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "pincer.web.auth" }));
    expect(useSession.getState().identity?.id).toBe("bob");
    expect(queryClient.getQueryData(["voice", "calls"])).toBeUndefined();
  });

  it("logout clears the session even when the server cannot be reached", async () => {
    fetchMock.mockImplementation(backend({ "/api/auth/login": () => json(PAIR), "/api/identity/me": () => json(ME), "/api/auth/logout": () => Promise.reject(new TypeError("Failed to fetch")) }));
    await useSession.getState().login({ identifier: "alice", password: "pw", apiUrl: "http://api.test" });
    expect(() => useSession.getState().logout()).not.toThrow();
    await Promise.resolve();
    expect(getAuth()).toBeNull();
    expect(useSession.getState().connected).toBe(false);
    expect(useSession.getState().lastDisconnect).toBe("user");
  });

  it("re-reads the session when another tab changes it", async () => {
    fetchMock.mockImplementation(backend({ "/api/auth/login": () => json(PAIR), "/api/identity/me": () => json(ME) }));
    await useSession.getState().login({ identifier: "alice", password: "pw", apiUrl: "http://api.test", remember: true });
    // The other tab signed out: the record is gone, this tab's memory copy is not.
    localStorage.removeItem("pincer.web.auth");
    window.dispatchEvent(new StorageEvent("storage", { key: "pincer.web.auth" }));
    expect(useSession.getState().connected).toBe(false);
    expect(getAuth()).toBeNull();
  });

  it("changePassword swaps the token pair and keeps the session where it was", async () => {
    const next = { ...PAIR, access_token: "access-2", refresh_token: "refresh-2" };
    fetchMock.mockImplementation(backend({ "/api/auth/login": () => json(PAIR), "/api/identity/me": () => json(ME), "/api/identity/me/password": () => json(next) }));
    await useSession.getState().login({ identifier: "alice", password: "old password", apiUrl: "http://api.test", remember: true });
    queryClient.setQueryData(["voice", "calls"], [{ call_sid: "CA-1" }]);
    await useSession.getState().changePassword("old password", " new password ");

    const [url, init] = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/api/identity/me/password"))!;
    expect(url).toBe("http://api.test/api/identity/me/password");
    expect(init!.method).toBe("PUT");
    // Passwords are sent exactly as typed.
    expect(JSON.parse(init!.body as string)).toEqual({ current_password: "old password", new_password: " new password " });
    expect(getAuth()).toMatchObject({ apiUrl: "http://api.test", token: "access-2", refreshToken: "refresh-2", userId: "alice" });
    expect(isAuthPersisted()).toBe(true);
    expect(localStorage.getItem("pincer.web.auth")).toContain("refresh-2");
    expect(sessionStorage.getItem("pincer.web.auth")).toBeNull();
    expect(useSession.getState().connected).toBe(true);
    // Same person: what they loaded is still theirs.
    expect(queryClient.getQueryData(["voice", "calls"])).toEqual([{ call_sid: "CA-1" }]);
    queryClient.clear();
  });

  it("changePassword stores nothing when the server refuses", async () => {
    fetchMock.mockImplementation(backend({ "/api/auth/login": () => json(PAIR), "/api/identity/me": () => json(ME), "/api/identity/me/password": () => json({ detail: "Current password is incorrect" }, 403) }));
    await useSession.getState().login({ identifier: "alice", password: "pw", apiUrl: "http://api.test" });
    await expect(useSession.getState().changePassword("wrong", "new password")).rejects.toMatchObject({ status: 403 });
    expect(getAuth()).toMatchObject({ token: "access-1", refreshToken: "refresh-1" });
    expect(useSession.getState().connected).toBe(true);
  });

  it("changePassword drops the new pair when the session ended while it was in the air", async () => {
    let answer!: (r: Response) => void;
    fetchMock.mockImplementation(
      backend({
        "/api/auth/login": () => json(PAIR),
        "/api/identity/me": () => json(ME),
        "/api/identity/me/password": () => new Promise<Response>((resolve) => (answer = resolve)),
        "/api/auth/logout": () => new Response(null, { status: 204 }),
      }),
    );
    await useSession.getState().login({ identifier: "alice", password: "pw", apiUrl: "http://api.test" });
    const change = useSession.getState().changePassword("pw", "new password");
    await vi.waitFor(() => expect(answer).toBeDefined());
    useSession.getState().logout();
    answer(json({ ...PAIR, access_token: "access-2", refresh_token: "refresh-2" }));
    await change;

    expect(getAuth()).toBeNull();
    expect(sessionStorage.getItem("pincer.web.auth")).toBeNull();
    expect(useSession.getState().connected).toBe(false);
    // The pair nobody holds is ended on the server, not left live.
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/api/auth/logout") && (c[1]!.headers as Record<string, string>).Authorization === "Bearer access-2")).toBe(true),
    );
  });

  it("falls back to the build's API URL, then the page origin", () => {
    expect(defaultApiUrl()).toBe(window.location.origin);
  });
});

describe("returnTo", () => {
  afterEach(() => {
    useSession.getState().setReturnTo(null);
    window.history.pushState({}, "", "/");
  });

  it("honours a same-origin path from the query", () => {
    window.history.pushState({}, "", "/login?returnTo=%2Ftelephony%2Fcalls%3Fview%3Dtable");
    expect(resolveReturnTo("/dashboard")).toBe("/telephony/calls?view=table");
  });

  it("rejects another origin and anything carrying a credential", () => {
    for (const bad of ["https://evil.example/x", "//evil.example/x", "/\\evil.example/x", "/x\\y", "/x?token=abc", "javascript:alert(1)"]) {
      expect(safeReturnTo(bad)).toBeNull();
      window.history.pushState({}, "", `/login?returnTo=${encodeURIComponent(bad)}`);
      expect(resolveReturnTo("/dashboard")).toBe("/dashboard");
    }
  });

  it("falls back to where the session was lost, then to the default", () => {
    window.history.pushState({}, "", "/login");
    useSession.getState().setReturnTo("/company-brain/memory");
    expect(resolveReturnTo("/dashboard")).toBe("/company-brain/memory");
    useSession.getState().setReturnTo(null);
    expect(resolveReturnTo("/dashboard")).toBe("/dashboard");
  });
});

describe("can()", () => {
  it("gates by role with owner as the phase-1 default", () => {
    expect(canRole("owner", "view_full_number")).toBe(true);
    expect(canRole("owner", "view_costs")).toBe(true);
    expect(canRole("staff", "view_full_number")).toBe(false);
    expect(canRole("staff", "start_call")).toBe(true);
    expect(canRole(null, "start_call")).toBe(false);
  });
});
