/**
 * Text contrast on every main route, in light and in dark.
 *
 * Only axe's `color-contrast` rule runs here (a11y.spec.ts owns the rest), so
 * nothing is excluded: the sidebar, the marketing shell and the chat thread
 * are all chrome a reader has to be able to read, in both themes.
 *
 * Light passes since slice 9 (the pincer-sh palette, with its text ramp
 * darkened until every step clears AA). Dark is a known failure until slice 11
 * (dark palette): when it lands, its cases start passing and Playwright
 * reports "expected to fail" — remove the marks then.
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

/** Schemes whose checks are still a known failure, and why. */
const PENDING: Partial<Record<(typeof SCHEMES)[number], string>> = {
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

/** Relative luminance (WCAG) at or above which a page does not count as dark. */
const DARK_LUMINANCE = 0.2;

async function open(page: Page, route: Route) {
  await mockBackend(page, { "/api/costs/today": null, ...route.fixtures });
  if (route.auth) await loginAsOwner(page);
  await page.goto(route.path);
  await route.ready(page);
  await page.addStyleTag({ content: RESOLVABLE });
}

async function analyse(page: Page) {
  return new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
}

/**
 * How dark the page really is: the root `--bg` token (what the dark palette
 * redefines) and the body background, as WCAG relative luminance. A dark
 * contrast check on a page that is still light would pass without testing
 * anything, so dark contrast only counts once both are dark.
 */
async function darkness(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const rgb = (css: string) => {
      probe.style.color = "";
      probe.style.color = css;
      return (getComputedStyle(probe).color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    };
    const luminance = ([r, g, b]: number[]) =>
      [r, g, b]
        .map((c) => c / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    const body = getComputedStyle(document.body).backgroundColor;
    const result = { bg, bgLuminance: luminance(rgb(bg)), body, bodyLuminance: luminance(rgb(body)) };
    probe.remove();
    return result;
  });
}

async function expectDark(page: Page, route: Route) {
  const d = await darkness(page);
  const why = `${route.path} is not dark: --bg ${d.bg} (luminance ${d.bgLuminance.toFixed(3)}), body ${d.body} (luminance ${d.bodyLuminance.toFixed(3)})`;
  expect(d.bgLuminance, why).toBeLessThan(DARK_LUMINANCE);
  expect(d.bodyLuminance, why).toBeLessThan(DARK_LUMINANCE);
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
        await open(page, route);
        const results = await analyse(page);
        const unresolved = results.incomplete.flatMap((v) => v.nodes.map(describeNode));
        expect(
          unresolved.length,
          `${route.path} in ${scheme}: the contrast check is blind — axe could not resolve ${unresolved.length} node(s)\n${unresolved.join("\n")}`,
        ).toBeLessThanOrEqual(MAX_UNRESOLVED);
      });

      if (scheme === "dark") {
        test(`renders dark in dark mode: ${route.name} (${route.path})`, async ({ page }) => {
          test.fail(true, PENDING.dark);
          await open(page, route);
          await expectDark(page, route);
        });
      }

      test(`contrast: ${route.name} (${route.path}) in ${scheme}`, async ({ page }) => {
        test.fail(scheme in PENDING, PENDING[scheme]);
        await open(page, route);
        // A light page passing a "dark" contrast check would test nothing.
        if (scheme === "dark") await expectDark(page, route);
        const results = await analyse(page);
        const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        const nodes = blocking.flatMap((v) => v.nodes.map(describeNode));
        expect(nodes, `${route.path} in ${scheme}: ${nodes.length} node(s) fail color-contrast\n${nodes.join("\n")}`).toEqual([]);
      });
    }
  });
}
