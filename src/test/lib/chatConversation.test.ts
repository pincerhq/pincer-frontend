/**
 * Pincer keys a signed-in conversation on the identity and ignores
 * `X-Pincer-User`, so a chat of its own is a `conversation_id` on the request:
 * the page's chats, call summaries and company-brain questions each send one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuth, sendChat, setAuth, streamChat } from "@/lib/pincerClient";
import { generateCallSummary } from "@/lib/api/voice";
import { askCompanyBrain } from "@/lib/api/company";

const CONV = "33333333-3333-4333-8333-333333333333";
const reply = () =>
  new Response(JSON.stringify({ reply: "ok" }), { status: 200, headers: { "content-type": "application/json" } });

describe("chat conversation ids", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1]!.body as string);
  const lastHeaders = () => fetchMock.mock.calls.at(-1)![1]!.headers as Record<string, string>;

  beforeEach(() => {
    localStorage.clear();
    setAuth({
      apiUrl: "http://api.test",
      token: "secret-token",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 10 * 60_000,
      userId: "alice",
    });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => reply());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    clearAuth();
    vi.unstubAllGlobals();
  });

  it("sends the conversation id on both chat endpoints, and none without one", async () => {
    await sendChat("hi");
    expect(lastBody()).toEqual({ text: "hi" });

    await sendChat("hi", CONV);
    expect(lastBody()).toEqual({ text: "hi", conversation_id: CONV });

    for await (const _ of streamChat("hi", undefined, CONV)) {
      /* drain */
    }
    expect(lastBody()).toEqual({ text: "hi", conversation_id: CONV });
  });

  it("runs call summaries and the company brain in conversations of their own", async () => {
    await generateCallSummary("transcript");
    const summary = lastBody().conversation_id;
    expect(summary).toMatch(/^[0-9a-f-]{36}$/);
    expect(lastHeaders()["X-Pincer-User"]).not.toMatch(/call-summarizer/);

    await generateCallSummary("another transcript");
    expect(lastBody().conversation_id).toBe(summary);

    await askCompanyBrain("what is our refund policy?");
    const brain = lastBody().conversation_id;
    expect(brain).toMatch(/^[0-9a-f-]{36}$/);
    expect(brain).not.toBe(summary);
  });
});
