/**
 * Pincer keys a signed-in conversation on the identity and ignores
 * `X-Pincer-User`, so a chat of its own is a `conversation_id` on the request:
 * the page's chats send their own, and call summaries and company-brain
 * questions a new one per request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuth, fetchCallReports, sendChat, setAuth, streamChat } from "@/lib/pincerClient";
import { fetchMissingReports, watchCallReports } from "@/lib/callReports";
import type { ChatTranscript } from "@/lib/chatTranscripts";
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

  it("keeps call summaries and company-brain requests out of the person's memory", async () => {
    await generateCallSummary("transcript");
    expect(lastBody().memory).toBe(false);

    await askCompanyBrain("what is our refund policy?");
    expect(lastBody().memory).toBe(false);
  });

  it("runs every call summary and company-brain request in a new conversation", async () => {
    await generateCallSummary("transcript");
    const summary = lastBody().conversation_id;
    expect(summary).toMatch(/^[0-9a-f-]{36}$/);
    expect(lastHeaders()["X-Pincer-User"]).not.toMatch(/call-summarizer/);

    await generateCallSummary("another transcript");
    expect(lastBody().conversation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(lastBody().conversation_id).not.toBe(summary);

    await askCompanyBrain("what is our refund policy?");
    const brain = lastBody().conversation_id;
    await askCompanyBrain("what is our refund policy?");
    expect(lastBody().conversation_id).not.toBe(brain);
    expect([summary, brain]).not.toContain(lastBody().conversation_id);
  });
});

describe("call reports", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    setAuth({
      apiUrl: "http://api.test",
      token: "secret-token",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 10 * 60_000,
      userId: "alice",
    });
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    clearAuth();
    vi.unstubAllGlobals();
  });

  it("asks for the reports of one conversation, or of the main one without an id", async () => {
    await fetchCallReports(CONV, "2026-11-02T10:00:00.000Z");
    const url = new URL(String(fetchMock.mock.calls.at(-1)![0]));
    expect(url.pathname).toBe("/api/chat/call-reports");
    expect(url.searchParams.get("conversation_id")).toBe(CONV);
    expect(url.searchParams.get("since")).toBe("2026-11-02T10:00:00.000Z");

    await fetchCallReports();
    const bare = new URL(String(fetchMock.mock.calls.at(-1)![0]));
    expect(bare.search).toBe("");
  });

  const respond = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const report = (callSid: string) => ({
    call_sid: callSid,
    outcome: "busy",
    text: `report ${callSid}`,
    created_at: "",
    reported_at: "",
  });
  const chat = (over: Partial<ChatTranscript> = {}): ChatTranscript => ({
    id: "chat",
    ownerId: "alice",
    createdAt: "2026-11-02T09:00:00.000Z",
    updatedAt: "2026-11-02T09:00:00.000Z",
    messages: [],
    calls: [{ callSid: "CA1", at: new Date().toISOString() }],
    ...over,
  });
  // A watch over a transcript the test holds; stored reports land in it.
  const watch = (t: ChatTranscript, extra: Partial<Parameters<typeof watchCallReports>[0]> = {}) =>
    watchCallReports({
      transcript: async () => t,
      onReports: async reports => {
        t.messages.push(...reports.map(r => ({ id: `call-report-${r.call_sid}`, role: "assistant" as const, text: r.text, at: "" })));
      },
      signal: new AbortController().signal,
      intervalMs: 1,
      ...extra,
    });

  it("polls until the awaited report arrives, then stops", async () => {
    const answers = [[], [report("CA1")]];
    fetchMock.mockImplementation(async () => respond(answers.shift() ?? [report("CA1")]));
    const t = chat({ conversationId: CONV });
    expect(await watch(t)).toBe("done");
    expect(t.messages.map(m => m.id)).toEqual(["call-report-CA1"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("counts a report stored by someone else as arrived", async () => {
    const t = chat({ conversationId: CONV });
    const end = watch(t, {
      onReports: async () => {
        throw new Error("nothing is left for this watch to store");
      },
    });
    t.messages.push({ id: "call-report-CA1", role: "assistant", text: "stored by a catch-up", at: "" });
    expect(await end).toBe("done");
  });

  it("gives up once the limit has passed since the latest awaited call", async () => {
    const t = chat({
      conversationId: CONV,
      calls: [
        { callSid: "CA1", at: "2026-11-02T10:00:00.000Z" },
        { callSid: "CA2", at: "2026-11-02T10:20:00.000Z" },
      ],
    });
    // 29 minutes after the latest call: still waiting, one more poll.
    let now = Date.parse("2026-11-02T10:49:00.000Z");
    fetchMock.mockImplementation(async () => {
      now += 2 * 60_000;
      return respond([]);
    });
    expect(await watch(t, { now: () => now })).toBe("gave-up");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("takes only the calls it placed on the main web conversation, and asks nothing without one", async () => {
    fetchMock.mockImplementation(async () => respond([report("CA1"), report("CA9")]));
    const t = chat({ calls: [{ callSid: "CA1", at: "2026-11-02T10:00:00.000Z" }] });
    expect((await fetchMissingReports(t)).map(r => r.call_sid)).toEqual(["CA1"]);
    const url = new URL(String(fetchMock.mock.calls.at(-1)![0]));
    expect(url.searchParams.get("conversation_id")).toBeNull();
    expect(url.searchParams.get("since")).toBe("2026-11-02T09:55:00.000Z");

    fetchMock.mockClear();
    expect(await fetchMissingReports(chat({ calls: undefined }))).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("takes every new report of a conversation of its own", async () => {
    fetchMock.mockImplementation(async () => respond([report("CA1"), report("CA9")]));
    const t = chat({
      conversationId: CONV,
      messages: [{ id: "call-report-CA1", role: "assistant", text: "stored", at: "" }],
    });
    expect((await fetchMissingReports(t)).map(r => r.call_sid)).toEqual(["CA9"]);
    const url = new URL(String(fetchMock.mock.calls.at(-1)![0]));
    expect(url.searchParams.get("since")).toBe("2026-11-02T08:55:00.000Z");
  });
});
