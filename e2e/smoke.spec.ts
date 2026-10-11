import { expect, test } from "@playwright/test";
import { E2E_USER, MOCK_API, OWNER_LOGIN_LABELS, PLATFORM_LOGIN_LABELS, loginAsOwner, mockBackend, signIn } from "./helpers";

test.describe("entry and login pages render", () => {
  test("home goes to the sign-in form", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("platform login page renders its form, without a sign-up link by default", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByLabel("Name or email")).toHaveAttribute("autocomplete", "username");
    await expect(page.getByRole("link", { name: /sign up|request access/i })).toHaveCount(0);
  });

  test("/signup does not exist in a default build", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "Page Not Found" })).toBeVisible();
  });
});

for (const login of [
  { name: "platform login", path: "/login", labels: PLATFORM_LOGIN_LABELS, home: /\/dashboard$/, invalid: "Name/email or password is incorrect.", locked: "Too many failed attempts. Try again in a few minutes." },
  { name: "owner login (FE1)", path: "/telephony/login", labels: OWNER_LOGIN_LABELS, home: /\/telephony$/, invalid: "Name/E-Mail oder Passwort ist falsch.", locked: "Zu viele Fehlversuche. Bitte versuchen Sie es in einigen Minuten erneut." },
]) {
  test.describe(login.name, () => {
    test.beforeEach(async ({ page }) => {
      await mockBackend(page);
    });

    test("signs in by name and lands on the home screen, with nothing secret in the address bar", async ({ page }) => {
      await page.goto(login.path);
      await signIn(page, login.labels, E2E_USER.name, E2E_USER.password);
      await expect(page).toHaveURL(login.home);
      expect(page.url()).not.toContain(encodeURIComponent(E2E_USER.password));
      // Session-only by default: the tab holds the pair, the device does not.
      const stored = await page.evaluate(() => ({ session: sessionStorage.getItem("pincer.web.auth"), local: localStorage.getItem("pincer.web.auth"), legacy: localStorage.getItem("isAuthenticated") ?? sessionStorage.getItem("isAuthenticated") }));
      expect(stored.session).toContain("e2e-refresh-1");
      expect(stored.local).toBeNull();
      expect(stored.legacy).toBeNull();
      // A reload keeps the session.
      await page.reload();
      await expect(page).toHaveURL(login.home);
    });

    test("signs in by e-mail in any case and returns to where the guard sent the person from", async ({ page }) => {
      await page.goto("/telephony/calls");
      await expect(page).toHaveURL(/\/telephony\/login\?returnTo=%2Ftelephony%2Fcalls$/);
      await page.goto(`${login.path}?returnTo=${encodeURIComponent("/telephony/calls")}`);
      await signIn(page, login.labels, "Alice@Example.COM", E2E_USER.password);
      await expect(page).toHaveURL(/\/telephony\/calls$/);
    });

    test("a wrong password stays on the page with one generic error", async ({ page }) => {
      await page.goto(login.path);
      await signIn(page, login.labels, E2E_USER.name, "wrong");
      await expect(page.getByRole("alert")).toHaveText(login.invalid);
      await signIn(page, login.labels, "nobody", E2E_USER.password);
      await expect(page.getByRole("alert")).toHaveText(login.invalid);
      await expect(page).toHaveURL(new RegExp(`${login.path}$`));
      expect(await page.evaluate(() => sessionStorage.getItem("pincer.web.auth"))).toBeNull();
    });

    test("a lockout says to wait instead of calling the password wrong", async ({ page }) => {
      await page.route("**/api/auth/login", (route) =>
        route.fulfill({ status: 429, contentType: "application/json", headers: { "access-control-allow-origin": "*", "retry-after": "900" }, body: JSON.stringify({ error: "locked_out", detail: "Too many failed authentication attempts" }) }),
      );
      await page.goto(login.path);
      await signIn(page, login.labels, E2E_USER.name, E2E_USER.password);
      await expect(page.getByRole("alert")).toContainText(/Too many failed attempts|Zu viele Fehlversuche/);
    });

    test("an unsafe returnTo is ignored", async ({ page }) => {
      await page.goto(`${login.path}?returnTo=${encodeURIComponent("https://evil.example/")}`);
      await signIn(page, login.labels, E2E_USER.name, E2E_USER.password);
      await expect(page).toHaveURL(login.home);
    });
  });
}

test.describe("session lifecycle", () => {
  test("an expired access token is refreshed once, transparently", async ({ page }) => {
    await mockBackend(page);
    const refreshes: string[] = [];
    // The seeded token is already expired on the server's side.
    await page.route(`${MOCK_API}/api/**`, async (route) => {
      const request = route.request();
      if (request.url().endsWith("/api/auth/refresh")) {
        refreshes.push(request.postDataJSON().refresh_token);
        return route.fallback();
      }
      if (request.headers().authorization === "Bearer e2e-access-0") {
        return route.fulfill({ status: 401, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ error: "token_expired", detail: "Token expired" }) });
      }
      return route.fallback();
    });
    await loginAsOwner(page);
    await page.goto("/telephony");
    await expect(page.getByRole("heading", { name: "Übersicht", level: 1 })).toBeVisible();
    await expect(page.getByTestId("card-costs")).toContainText("1,23");
    // Many requests saw the 401 at once; exactly one refresh was made, with the seeded token.
    expect(refreshes).toEqual(["e2e-refresh-0"]);
    expect(await page.evaluate(() => sessionStorage.getItem("pincer.web.auth"))).toContain("e2e-access-1");
  });

  test("a token about to expire is refreshed before the first request", async ({ page }) => {
    await mockBackend(page);
    const bearers = new Set<string>();
    page.on("request", (r) => {
      const auth = r.headers().authorization;
      if (auth && r.url().startsWith(MOCK_API)) bearers.add(auth);
    });
    await loginAsOwner(page, { expiresInMs: 5_000 });
    await page.goto("/telephony");
    await expect(page.getByRole("heading", { name: "Übersicht", level: 1 })).toBeVisible();
    expect([...bearers]).toEqual(["Bearer e2e-access-1"]);
  });

  test("a rejected refresh ends the session and returns to the same view after signing in again", async ({ page }) => {
    await mockBackend(page);
    let revoked = true;
    await page.route(`${MOCK_API}/api/**`, async (route) => {
      const request = route.request();
      if (!revoked) return route.fallback();
      const code = request.url().endsWith("/api/auth/refresh") ? "invalid_token" : "token_expired";
      return route.fulfill({ status: 401, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ error: code, detail: code }) });
    });
    await loginAsOwner(page);
    await page.goto("/telephony/calls");
    await expect(page).toHaveURL(/\/telephony\/login\?returnTo=%2Ftelephony%2Fcalls$/);
    await expect(page.getByRole("status")).toContainText("Ihre Sitzung ist abgelaufen");
    expect(await page.evaluate(() => sessionStorage.getItem("pincer.web.auth"))).toBeNull();
    revoked = false;
    await signIn(page, OWNER_LOGIN_LABELS, E2E_USER.name, E2E_USER.password);
    await expect(page).toHaveURL(/\/telephony\/calls$/);
  });

  test("logout ends the session on the server and the guard keeps the person out", async ({ page, isMobile }) => {
    test.skip(isMobile, "the account menu is the desktop rail's; the phone sheet has its own test");
    await mockBackend(page);
    await loginAsOwner(page);
    await page.goto("/telephony");
    const logout = page.waitForRequest((r) => r.url().endsWith("/api/auth/logout") && r.method() === "POST");
    await page.getByRole("button", { name: "Konto und Sprache" }).click();
    await page.getByRole("menuitem", { name: "Abmelden" }).click();
    expect((await logout).headers().authorization).toBe("Bearer e2e-access-0");
    await expect(page).toHaveURL(/\/telephony\/login$/);
    expect(await page.evaluate(() => sessionStorage.getItem("pincer.web.auth"))).toBeNull();
    await page.goto("/telephony/calls");
    await expect(page).toHaveURL(/\/telephony\/login\?returnTo=%2Ftelephony%2Fcalls$/);
  });

  test("a browser still holding the old shared-token session lands on the login, once", async ({ page }) => {
    await mockBackend(page);
    await page.addInitScript(() => {
      localStorage.setItem("isAuthenticated", "true");
      localStorage.setItem("userEmail", "owner");
      localStorage.setItem("pincer.web.auth", JSON.stringify({ apiUrl: "http://mock.pincer.local", token: "old-shared-token" }));
    });
    const navigations: string[] = [];
    page.on("framenavigated", (f) => f === page.mainFrame() && navigations.push(f.url()));
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fdashboard$/);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    // The stale records are gone, and the page settles: no redirect loop.
    expect(await page.evaluate(() => [localStorage.getItem("pincer.web.auth"), localStorage.getItem("isAuthenticated"), localStorage.getItem("userEmail")])).toEqual([null, null, null]);
    const settled = navigations.length;
    await page.waitForTimeout(750);
    expect(navigations.length).toBe(settled);
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fdashboard$/);
  });
});

test.describe("owner app shell", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
    await loginAsOwner(page);
  });

  test("home shows today, live calls, attention, status and costs on real (mocked) endpoints", async ({ page }) => {
    await page.goto("/telephony");
    await expect(page.getByRole("heading", { name: "Übersicht", level: 1 })).toBeVisible();
    const today = page.getByTestId("card-today");
    await expect(today.getByText("berechnet im Browser")).toBeVisible();
    await expect(today.getByText("Eingehend").locator("..").getByText("2")).toBeVisible();
    await expect(today.getByText("Termine").locator("..").getByText("1")).toBeVisible();
    const now = page.getByTestId("card-now");
    await expect(now).toContainText("Terminanfrage Jahresabschluss");
    await expect(now).toContainText("+49 171 ••• 4521");
    await expect(now).not.toContainText("conversation_relay");
    const attention = page.getByTestId("card-attention");
    await expect(attention).toContainText("Dringende Nachricht");
    await expect(attention).toContainText("Weiterleitung fehlgeschlagen");
    const status = page.getByTestId("card-status");
    await expect(status).toContainText("Rufumleitung");
    await expect(status).toContainText("2 Hinweise");
    await expect(status).toContainText("Verbunden (Google Workspace)");
    await expect(page.getByTestId("card-costs")).toContainText("1,23");
    await expect(page.locator("[data-banner-state=active]")).toContainText("+49 5223 ••• 4521");
  });

  test("navigates between primary areas", async ({ page, isMobile }) => {
    await page.goto("/telephony");
    const nav = isMobile ? page.getByRole("navigation", { name: "Ihr Empfang" }) : page.getByRole("complementary", { name: "Telefonie" });
    await expect(nav).toBeVisible();
    await nav.getByRole("button", { name: "Nachrichten" }).click();
    await expect(page).toHaveURL(/\/telephony\/messages$/);
    await expect(page.getByRole("heading", { name: "Messages", level: 1 })).toBeVisible();
    await nav.getByRole("button", { name: "Übersicht" }).click();
    await expect(page).toHaveURL(/\/telephony$/);
  });

  test("the 'Mehr' sheet reaches the other areas and logout on a phone", async ({ page, isMobile }) => {
    test.skip(!isMobile, "bottom tabs only exist under md");
    await page.goto("/telephony");
    await page.getByRole("button", { name: "Mehr" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Alle Bereiche")).toBeVisible();
    await sheet.getByRole("button", { name: "Richtlinien" }).click();
    await expect(page).toHaveURL(/\/telephony\/policies$/);
    await page.getByRole("button", { name: "Mehr" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Abmelden" }).click();
    await expect(page).toHaveURL(/\/telephony\/login$/);
  });

  test("desktop rail collapses and keeps its areas reachable", async ({ page, isMobile }) => {
    test.skip(isMobile);
    await page.goto("/telephony");
    const rail = page.getByRole("complementary", { name: "Telefonie" });
    await rail.getByRole("button", { name: "Navigation einklappen" }).click();
    await expect(rail).toHaveAttribute("data-collapsed", "true");
    await expect(rail.getByRole("button", { name: "Anrufe", exact: true })).toBeVisible();
  });

  test("status banner reports a lost connection after two failed health polls", async ({ page, isMobile }) => {
    test.skip(isMobile, "the poll cadence is not viewport-specific; one project is enough");
    test.slow(); // two real 30 s health polls — the spec's "within 60 s" is what is measured
    await page.goto("/telephony");
    await expect(page.locator("[data-banner-state=active]")).toBeVisible();
    await page.route(`${MOCK_API}/api/health`, (route) => route.abort("connectionrefused"));
    await expect(page.locator("[data-banner-state=offline]")).toContainText("Verbindung zum Server unterbrochen", { timeout: 90_000 });
  });

  test("language switch to English is persisted", async ({ page, isMobile }) => {
    test.skip(isMobile);
    await page.goto("/telephony");
    await page.getByRole("button", { name: "Konto und Sprache" }).click();
    await page.getByRole("menuitemradio", { name: "Englisch" }).click();
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  });

  test("never scrolls horizontally at 390 px", async ({ page, isMobile }) => {
    test.skip(!isMobile);
    await page.goto("/telephony");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("owner app without a session", () => {
  test("goes to the owner login with the view to return to, not a blank screen", async ({ page }) => {
    await page.goto("/telephony/calls");
    await expect(page).toHaveURL(/\/telephony\/login\?returnTo=%2Ftelephony%2Fcalls$/);
    await expect(page.getByLabel("Name oder E-Mail")).toBeVisible();
  });
});
