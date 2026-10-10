import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { FIXTURES, loginAsOwner, mockBackend } from "./helpers";

const PUBLIC = ["/login", "/telephony/login"];
const ROUTES = [...PUBLIC, "/telephony", "/telephony/calls", "/telephony/calls/CA-1", "/telephony/calls/live", "/telephony/calls/pending-approval", "/telephony/messages", "/telephony/planned", "/telephony/policies", "/telephony/settings"];

for (const route of ROUTES) {
  test(`axe: no serious or critical violations on ${route}`, async ({ page }) => {
    await mockBackend(page, {
      "/api/voice/calls/CA-1": { ...(FIXTURES["/api/voice/calls"] as Array<Record<string, unknown>>)[0], transcript: [], actions: [] },
    });
    if (!PUBLIC.includes(route)) await loginAsOwner(page);
    await page.goto(route);
    await page.getByRole("heading").first().waitFor();
    // Scoped to what the owner app owns: the platform's shared sidebar carries
    // an unlabeled icon button (AppSidebar.tsx, the notification bell) that is
    // recorded in docs/app/FE0-audit.md §1 as an ask to the platform owner.
    let axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude('[data-sidebar="sidebar"]');
    // /login sits in the marketing shell, whose story panel (`.m-lockup .kind`,
    // --text-3 / --text-4 on --sand) fails colour contrast independently of the
    // sign-in form. That is the shell's to fix; what is checked here is the form.
    if (route === "/login") axe = axe.include("form");
    const results = await axe.analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking, JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.html) })), null, 2)).toEqual([]);
  });
}
