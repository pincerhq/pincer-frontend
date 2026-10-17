/**
 * FE2 §8 — the owner vocabulary and PII rules behind the calls surfaces.
 */
import { describe, expect, it } from "vitest";
import {
  RESULT_GROUPS,
  applyFilters,
  buildCsv,
  contactIndex,
  contactNameFor,
  decorateCalls,
  intentKeyOf,
  looksLikeNumber,
  maskTranscriptText,
  parseFilters,
  parseTranscript,
  resultGroupOf,
  serializeFilters,
  DEFAULT_FILTERS,
} from "@/lib/api/owner/calls";
import { maskPhone } from "@/lib/format";
import type { CallSummary, TranscriptLine } from "@/lib/api/voice";

const base = (over: Partial<CallSummary> = {}): CallSummary => ({
  call_sid: "CA",
  direction: "inbound",
  status: "completed",
  from_number: "+4917112344521",
  to_number: "+495223000000",
  started_at: "2026-09-07T08:00:00Z",
  ended_at: null,
  duration_seconds: 60,
  ...over,
});

describe("resultGroupOf — every backend state maps to exactly one chip", () => {
  const cases: Array<[Partial<CallSummary> & { appointment?: never; outcome?: never } | Record<string, unknown>, string]> = [
    [{ status: "completed", appointment: { status: "calendar_created" } }, "booked"],
    [{ status: "completed", appointment: { status: "invitations_sent" } }, "booked"],
    [{ status: "completed", inbound_intent: "message" }, "message"],
    [{ status: "completed", inbound_intent: "human" }, "handoff"],
    [{ status: "completed" }, "done"],
    [{ status: "no-answer" }, "not_reached"],
    [{ status: "busy" }, "not_reached"],
    [{ status: "completed", outcome: { outcome: "voicemail" } }, "not_reached"],
    [{ status: "completed", outcome: { outcome: "declined" } }, "declined"],
    [{ status: "completed", failure_code: "briefing_lost" }, "failed"],
    [{ status: "failed" }, "failed"],
    [{ status: "active" }, "in_progress"],
    [{ status: "in-progress" }, "in_progress"],
    [{ status: "ringing", failure_code: "x" }, "in_progress"],
    [{ status: "completed", failure_code: "transfer_failed", appointment: { status: "calendar_created" } }, "failed"],
  ];
  it.each(cases)("%j → %s", (over, expected) => {
    expect(resultGroupOf(base(over as Partial<CallSummary>))).toBe(expected);
  });
  it("only ever returns a known group", () => {
    for (const status of ["completed", "no-answer", "busy", "failed", "canceled", "active", "in-progress", "queued", "weird", ""]) {
      expect(RESULT_GROUPS).toContain(resultGroupOf(base({ status })));
    }
  });
  it("maps intents and falls back to unknown", () => {
    expect(intentKeyOf(base({ inbound_intent: "appointment" }))).toBe("appointment");
    expect(intentKeyOf(base({ inbound_intent: "garbage" }))).toBe("unknown");
    expect(intentKeyOf(base({ inbound_intent: null }))).toBe("unknown");
  });
});

describe("filters ↔ URL", () => {
  it("round-trips every non-default filter and never a phone number", () => {
    const f = { ...DEFAULT_FILTERS, period: "today" as const, direction: "inbound" as const, result: "booked" as const, intent: "appointment" as const, hasAppointment: true, needsAttention: true, language: "de", q: "Müller" };
    const params = serializeFilters(f);
    expect(parseFilters(params)).toEqual(f);
    expect(params.toString()).toContain("q=M%C3%BCller");
    const withNumber = serializeFilters({ ...f, q: "+49 171 1234 4521" });
    expect(withNumber.toString()).not.toMatch(/171/);
    expect(parseFilters(new URLSearchParams("q=%2B4917112344521")).q).toBe("");
  });
  it("ignores unknown values", () => {
    expect(parseFilters(new URLSearchParams("period=yesterday&result=nope&dir=sideways"))).toEqual(DEFAULT_FILTERS);
  });
  it("recognises numbers", () => {
    expect(looksLikeNumber("+49 171 1234")).toBe(true);
    expect(looksLikeNumber("0171/1234567")).toBe(true);
    expect(looksLikeNumber("Müller")).toBe(false);
  });
});

describe("applyFilters", () => {
  const now = new Date("2026-09-07T12:00:00Z");
  const contacts = [{ name: "Erika Muster", phone_number: "0171 1234 4521", notes: "" }];
  const calls = decorateCalls(
    [
      base({ call_sid: "a", appointment: { status: "calendar_created" } as never }),
      base({ call_sid: "b", direction: "outbound", from_number: "+495223000000", to_number: "+4915112345678", started_at: "2026-08-01T08:00:00Z" }),
      base({ call_sid: "c", status: "no-answer", from_number: "+4915112345678", language: "en" }),
    ],
    contacts,
    new Set(["c"]),
  );
  it("matches contacts by normalised number", () => {
    expect(calls[0]!.contactName).toBe("Erika Muster");
    expect(contactNameFor(base({ from_number: "004917112344521" }), contactIndex(contacts))).toBe("Erika Muster");
  });
  it("filters by period, result, attention, language and name or exact number", () => {
    expect(applyFilters(calls, { ...DEFAULT_FILTERS, period: "7d" }, now).map((c) => c.call_sid)).toEqual(["a", "c"]);
    expect(applyFilters(calls, { ...DEFAULT_FILTERS, period: "all", result: "booked" }, now).map((c) => c.call_sid)).toEqual(["a"]);
    expect(applyFilters(calls, { ...DEFAULT_FILTERS, needsAttention: true }, now).map((c) => c.call_sid)).toEqual(["c"]);
    expect(applyFilters(calls, { ...DEFAULT_FILTERS, language: "en" }, now).map((c) => c.call_sid)).toEqual(["c"]);
    expect(applyFilters(calls, { ...DEFAULT_FILTERS, q: "erika" }, now).map((c) => c.call_sid)).toEqual(["a"]);
    expect(applyFilters(calls, { ...DEFAULT_FILTERS, q: "0151 1234 5678" }, now).map((c) => c.call_sid)).toEqual(["c"]);
    expect(applyFilters(calls, { ...DEFAULT_FILTERS, q: "0151 1234" }, now)).toEqual([]);
  });
});

describe("transcript", () => {
  const lines: TranscriptLine[] = [
    { speaker: "system", text: "[BRIEFING] Bitte Termin mit Herrn Schmidt unter +49 171 1234 4521 vereinbaren", confidence: 1, state: "", timestamp: "2026-09-07T08:00:00Z" },
    { speaker: "agent", text: "Guten Tag, hier ist der KI-Assistent.", confidence: 1, state: "delivered", timestamp: "2026-09-07T08:00:01Z" },
    { speaker: "caller", text: "Meine Nummer ist 0171 1234 4521, rufen Sie zurück.", confidence: 0.9, state: "", timestamp: "2026-09-07T08:00:05Z" },
    { speaker: "system", text: "[DISCLOSURE] AI disclosure announced", confidence: 1, state: "", timestamp: "2026-09-07T08:00:06Z" },
    { speaker: "system", text: "[TRANSFER] handoff to +49 5223 00 00 00", confidence: 1, state: "", timestamp: "2026-09-07T08:00:09Z" },
    { speaker: "agent", text: "Alles klar.", confidence: 1, state: "undelivered", timestamp: "2026-09-07T08:00:10Z" },
  ];
  it("turns SYSTEM lines into events and keeps speech as lines with owner labels", () => {
    const items = parseTranscript(lines, true);
    expect(items.map((i) => (i.kind === "event" ? `event:${i.event}` : `line:${i.speaker}`))).toEqual([
      "event:briefing",
      "line:assistant",
      "line:caller",
      "event:disclosure",
      "event:handoff",
      "line:assistant",
    ]);
    expect(items[5]).toMatchObject({ kind: "line", undelivered: true });
  });
  it("masks numbers in speech and events, and unmasks on request", () => {
    const masked = parseTranscript(lines, true);
    expect(masked[2]!.text).toBe("Meine Nummer ist +49 ••• 21, rufen Sie zurück.".replace("+49", "01"));
    expect(masked[0]!.text).not.toContain("1234");
    expect(masked[4]!.text).not.toContain("5223 00");
    const full = parseTranscript(lines, false);
    expect(full[2]!.text).toContain("0171 1234 4521");
  });
  it("leaves short digit runs alone", () => {
    expect(maskTranscriptText("Zimmer 12, um 14:30 Uhr")).toBe("Zimmer 12, um 14:30 Uhr");
    expect(maskTranscriptText("+49 171 1234 4521")).toBe("+49 ••• 21");
  });
});

describe("CSV export", () => {
  it("contains masked numbers only and escapes separators", () => {
    const calls = decorateCalls([base({ call_sid: "a", thread_subject: 'Angebot; "Sonder"' })], [], new Set());
    const csv = buildCsv(calls, { headers: ["Zeit", "Richtung", "Kontakt", "Nummer", "Ergebnis", "Anliegen", "Dauer", "Termin", "Sprache"], result: (g) => g, intent: (k) => k, direction: (d) => d }, maskPhone);
    expect(csv).toContain("+49 171 ••• 4521");
    expect(csv).not.toContain("4917112344521");
    expect(csv.split("\n")[1]).toContain("inbound;;+49 171 ••• 4521;done;unknown;60;;");
  });
});
