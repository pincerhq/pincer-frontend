/**
 * FE1 §3 — the browser-side computations the badged cards rely on.
 */
import { describe, expect, it } from "vitest";
import { computeAttention, computeTodayStats, isAfterHours, residencyMode, doctorHints, telephonyFacts } from "@/lib/api/owner/overview";
import type { BusinessProfile, CallSummary, InboundMessage } from "@/lib/api/voice";

const profile: BusinessProfile = {
  enabled: true,
  name: "Kanzlei",
  languages: ["de"],
  timezone: "Europe/Berlin",
  hours: { mon: [{ from: "09:00", to: "17:00" } as never] },
  services_count: 0,
  faq_count: 0,
  booking: { enabled: true, duration_minutes: 30 },
  transfer: { enabled: false },
  after_hours: null,
};

const call = (over: Partial<CallSummary>): CallSummary => ({
  call_sid: "CA1",
  direction: "inbound",
  status: "completed",
  from_number: "+4917112344521",
  to_number: "+495223000",
  started_at: "2026-09-07T08:00:00Z", // Monday 10:00 Berlin
  ended_at: null,
  duration_seconds: 60,
  ...over,
});

describe("computeTodayStats", () => {
  const now = new Date("2026-09-07T12:00:00Z");
  it("counts only today's calls in the business zone", () => {
    const calls = [
      call({ call_sid: "a" }),
      call({ call_sid: "b", direction: "outbound" }),
      call({ call_sid: "c", status: "no-answer", duration_seconds: 0 }),
      call({ call_sid: "d", started_at: "2026-09-06T21:30:00Z" }), // 23:30 Berlin yesterday
      call({ call_sid: "e", started_at: "2026-09-07T19:00:00Z" }), // 21:00 Berlin — after hours
      call({ call_sid: "f", appointment: { status: "calendar_created" } as never }),
    ];
    const messages: InboundMessage[] = [
      { id: "1", call_sid: "a", caller_name: null, caller_number: null, matter: "x", urgency: "normal", created_at: "2026-09-07T09:00:00Z" },
      { id: "2", call_sid: "d", caller_name: null, caller_number: null, matter: "y", urgency: "normal", created_at: "2026-09-06T21:00:00Z" },
    ];
    const s = computeTodayStats(calls, messages, profile, now);
    expect(s).toEqual({ inbound: 4, outbound: 1, answered: 4, missed: 1, afterHours: 1, bookings: 1, messages: 1, total: 5 });
  });

  it("never counts a call that is still running as missed, whatever live status it reports", () => {
    const calls = ["active", "in-progress", "ringing", "Active"].map((status, i) =>
      call({ call_sid: `live-${i}`, status, duration_seconds: 0, ended_at: null }),
    );
    const s = computeTodayStats(calls, [], profile, now);
    expect(s.missed).toBe(0);
    expect(s.answered).toBe(4);
  });

  it("treats a day without hours as after-hours and unknown hours as open", () => {
    expect(isAfterHours("2026-09-06T10:00:00Z", profile)).toBe(true); // Sunday
    expect(isAfterHours("2026-09-07T10:00:00Z", profile)).toBe(false);
    expect(isAfterHours("2026-09-07T10:00:00Z", null)).toBe(false);
  });
});

describe("computeAttention", () => {
  it("ranks urgent messages and failed handoffs first and caps the list", () => {
    const messages: InboundMessage[] = [
      { id: "1", call_sid: "m1", caller_name: null, caller_number: "+491", matter: "Bitte um Rückruf", urgency: "normal", created_at: "2026-09-07T09:00:00Z" },
      { id: "2", call_sid: "m2", caller_name: null, caller_number: "+492", matter: "Dringend", urgency: "urgent", created_at: "2026-09-07T08:00:00Z" },
      { id: "3", call_sid: "m3", caller_name: null, caller_number: "+493", matter: "gelesen", urgency: "normal", created_at: "2026-09-07T07:00:00Z", read_at: "2026-09-07T07:30:00Z" },
    ];
    const calls = [
      call({ call_sid: "h1", failure_code: "transfer_failed", failure_description: "Niemand hat abgenommen" }),
      call({ call_sid: "m1" }), // already covered by its message
      call({ call_sid: "ok" }),
    ];
    const items = computeAttention(calls, messages, 5);
    expect(items.map((i) => i.kind)).toEqual(["urgent_message", "handoff_failed", "callback"]);
    expect(items[0]!.number).toBe("+492");
    expect(items[1]!.summary).toBe("Niemand hat abgenommen");
    expect(computeAttention(calls, messages, 1)).toHaveLength(1);
  });
});

describe("status helpers", () => {
  it("maps residency and doctor and telephony shapes defensively", () => {
    expect(residencyMode({ mode: "eu_verified" })).toBe("eu_verified");
    expect(residencyMode({ mode: "something" })).toBe("unknown");
    expect(residencyMode(null)).toBe("unknown");
    expect(doctorHints({ warnings: 2, critical: 1 })).toBe(3);
    expect(doctorHints(null)).toBeNull();
    expect(telephonyFacts({ telephony: { mode: "sip", number_masked: "+49 5223 ••• 12", sip_registered: false } })).toEqual({
      mode: "sip",
      numberMasked: "+49 5223 ••• 12",
      sipRegistered: false,
      failoverHint: null,
    });
    expect(telephonyFacts({ enabled: true })).toEqual({ mode: "unknown", numberMasked: null, sipRegistered: null, failoverHint: null });
  });
});
