/**
 * Text contrast on every main route, in light and in dark.
 *
 * Only axe's `color-contrast` rule runs here (a11y.spec.ts owns the rest), so
 * nothing is excluded: the sidebar, the marketing shell and the chat thread
 * are all chrome a reader has to be able to read, in both themes.
 *
 * Every case is a known failure today. The light ones wait on slice 9 (light
 * palette; the PRD allows contrast adjustments where AA fails), the dark ones
 * on slice 11 (dark palette). When a slice lands, its cases start passing and
 * Playwright reports "expected to fail" — remove the mark then.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { loginAsOwner, mockBackend } from "./helpers";

type Route = {
  name: string;
  path: string;
  auth: boolean;
  /** Extra mocked responses for this route. */
  fixtures?: Record<string, unknown>;
  /** Bring the page to the state worth checking; resolve once it is there. */
  ready: (page: Page) => Promise<void>;
};

/** An assistant reply with inline code and a fenced block, then a pending approval. */
const REPLY = [
  "## Deploy plan",
  "Run `npm run build` first, then see the [release notes](https://example.com/notes).",
  "",
  "```bash",
  "npm run build && npm run preview",
  "```",
  "",
  "- check the bundle size",
  "- **then** ship it",
].join("\n");

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const CHAT_STREAM = [
  sse("tool", { phase: "start", name: "web_search" }),
  sse("tool", { phase: "done", name: "web_search" }),
  sse("chunk", { delta: REPLY }),
  sse("approval", { approval_id: "ap-1", tool: "send_email", args: { to: "team@example.com" } }),
  sse("done", { text: REPLY }),
].join("");

const CONVERSATIONS = {
  "/api/conversations": {
    conversations: [
      {
        id: "c1", user_id: "alice", channel: "web", category: "general", tags: [],
        preview: "What is on my calendar?", created_at: "2026-10-14T11:00:00Z", updated_at: "2026-10-14T11:00:00Z",
        messages: [{ role: "user", content: "What is on my calendar?" }, { role: "assistant", content: "Two meetings: `standup` at 10:00." }],
      },
    ],
    limit: 20,
    offset: 0,
  },
  "/api/conversations/c1": {
    id: "c1",
    messages: [
      { role: "user", content: "What is on my calendar?", timestamp: "2026-10-14T11:00:00Z" },
      { role: "assistant", content: "Two meetings: `standup` at 10:00 and a review at 15:00.", timestamp: "2026-10-14T11:00:05Z" },
    ],
  },
};

const firstHeading = async (page: Page) => {
  await page.getByRole("heading").first().waitFor();
};

const ROUTES: Route[] = [
  { name: "Login", path: "/login", auth: false, ready: firstHeading },
  { name: "Forgot password", path: "/forgot-password", auth: false, ready: firstHeading },
  { name: "Dashboard", path: "/dashboard", auth: true, ready: firstHeading },
  {
    name: "Chat",
    path: "/chat",
    auth: true,
    fixtures: CONVERSATIONS,
    ready: async (page) => {
      await page.route(
        (url) => url.pathname === "/api/chat/stream",
        (route) =>
          route.fulfill({
            status: 200,
            headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
            body: CHAT_STREAM,
          }),
      );
      await page.getByText("Two meetings:").first().waitFor();
      const composer = page.locator("textarea").first();
      await composer.fill("Plan the deploy");
      await composer.press("Enter");
      await page.getByText("Approval required").waitFor();
      await page.getByText("npm run build && npm run preview").waitFor();
    },
  },
  { name: "Tasks", path: "/tasks", auth: true, ready: firstHeading },
  { name: "Company", path: "/company-brain", auth: true, ready: firstHeading },
  { name: "Integrations", path: "/integrations", auth: true, ready: firstHeading },
];

const SCHEMES = ["light", "dark"] as const;

const PENDING: Record<(typeof SCHEMES)[number], string> = {
  light: "slice 9: light palette — PRD allows contrast adjustments where AA fails",
  dark: "slice 11: dark palette",
};

/**
 * axe cannot resolve a colour behind a background-image or a pseudo-element
 * and reports those nodes as "incomplete" — neither pass nor fail. The app
 * canvas (`.platform`) is painted entirely by gradients, and the auth art
 * panel has decorative facets; left alone, most text on every page goes
 * unchecked. The canvas becomes its base colour (`--bg`, what the wash sits
 * on), the facets go (they sit behind the white card, never behind text).
 */
const RESOLVABLE = `
  .platform, .plat { background-image: none !important; background-color: var(--bg) !important; }
  .m-auth-art::before, .m-auth-art::after { content: none !important; }
`;

/** More unresolved nodes than this and the check is blind, not passing. */
const MAX_UNRESOLVED = 2;

async function analyse(page: Page, route: Route) {
  await mockBackend(page, { "/api/costs/today": null, ...route.fixtures });
  if (route.auth) await loginAsOwner(page);
  await page.goto(route.path);
  await route.ready(page);
  await page.addStyleTag({ content: RESOLVABLE });
  return new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
}

const describeNode = (n: { target: unknown[]; html: string; any: { data?: unknown; message?: string }[] }) => {
  const data = (n.any[0]?.data ?? {}) as { fgColor?: string; bgColor?: string; contrastRatio?: number; expectedContrastRatio?: string };
  const colours = data.fgColor ? `${data.fgColor} on ${data.bgColor} = ${data.contrastRatio}:1 (needs ${data.expectedContrastRatio})` : (n.any[0]?.message ?? "");
  return `  ${n.target.join(" ")}  ${colours}\n    ${n.html.slice(0, 160)}`;
};

for (const scheme of SCHEMES) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme, reducedMotion: "reduce" });

    for (const route of ROUTES) {
      test(`axe can see every background: ${route.name} (${route.path}) in ${scheme}`, async ({ page }) => {
        const results = await analyse(page, route);
        const unresolved = results.incomplete.flatMap((v) => v.nodes.map(describeNode));
        expect(
          unresolved.length,
          `${route.path} in ${scheme}: the contrast check is blind — axe could not resolve ${unresolved.length} node(s)\n${unresolved.join("\n")}`,
        ).toBeLessThanOrEqual(MAX_UNRESOLVED);
      });

      test(`contrast: ${route.name} (${route.path}) in ${scheme}`, async ({ page }) => {
        test.fail(true, PENDING[scheme]);
        const results = await analyse(page, route);
        const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        const nodes = blocking.flatMap((v) => v.nodes.map(describeNode));
        expect(nodes, `${route.path} in ${scheme}: ${nodes.length} node(s) fail color-contrast\n${nodes.join("\n")}`).toEqual([]);
      });
    }
  });
}
