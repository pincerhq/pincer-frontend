/** FE10 §1 Security & privacy — no PII and no credential in request URLs, document.title or the console. */
import { expect, test } from "@playwright/test";
import { E2E_USER, MOCK_API, OWNER_LOGIN_LABELS, mockBackend, signIn } from "./helpers";

const PII = [/\+?49\s?1[57]\d{2}\s?\d{3}\s?\d{3,4}/, /4917112344521/, /4917212345678/, /Steuerbescheid/, /Erika/, /correct(%20|\+| )horse/, /e2e-(access|refresh)-/];

test("no PII leaves the browser in URLs, titles or console output", async ({ page }) => {
  const urls: string[] = [];
  const logs: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  page.on("console", (m) => logs.push(m.text()));
  await mockBackend(page);
  await page.goto("/telephony/login");
  await signIn(page, OWNER_LOGIN_LABELS, E2E_USER.name, E2E_USER.password);
  await expect(page).toHaveURL(/\/telephony$/);
  // The form posts to the build's own API address; point the session at MOCK_API so the rest of the walk is on fixtures.
  await page.evaluate((apiUrl) => {
    const record = JSON.parse(sessionStorage.getItem("pincer.web.auth")!);
    sessionStorage.setItem("pincer.web.auth", JSON.stringify({ ...record, apiUrl }));
  }, MOCK_API);
  await page.goto("/telephony/calls");
  await expect(page.getByText("+49 171 ••• 4521").first()).toBeVisible();
  await page.goto("/telephony/calls/CA-1");
  await expect(page).toHaveURL(/\/telephony\/calls\/CA-1$/);
  await page.goto("/telephony/messages");
  await page.goto("/telephony/policies");
  const titles = [await page.title()];
  // The password and the tokens travel in bodies and headers only — never in a URL.
  const checked = urls.filter((x) => !x.startsWith("data:"));
  for (const u of checked) for (const re of PII) expect(u, `PII in request URL ${u}`).not.toMatch(re);
  expect(checked.some((u) => u.startsWith(MOCK_API))).toBe(true);
  for (const t of titles) for (const re of PII) expect(t).not.toMatch(re);
  for (const l of logs) for (const re of PII) expect(l, `PII in console: ${l.slice(0, 80)}`).not.toMatch(re);
  expect(await page.evaluate(() => history.state?.usr ?? null)).toBeNull();
});
