/**
 * Phone call reports in the web chat (pincerhq/pincer#303).
 *
 * When the agent places a call, the tool only says it is ringing; the outcome
 * comes minutes later. Telegram and WhatsApp get it pushed, but web chat is
 * request/response, so the page asks `/api/chat/call-reports` for it.
 *
 * A turn that placed a call names its SID (the `make_phone_call` tool `done`
 * frame, or `call_sids` of a non-streamed reply). The chat notes it in its
 * transcript (`calls`), and waits for that report: every few seconds while
 * the page is open, and once more whenever the chat is opened. A refused or
 * failed dial names no SID, so nothing waits for it.
 *
 * A report is stored in the transcript as an assistant message with the id
 * `call-report-<call_sid>`. `saveMessages` replaces by id, so a report polled
 * twice, or by two tabs, is still shown once.
 */

import { fetchCallReports, type CallReport } from '@/lib/pincerClient';
import type { ChatTranscript, PlacedCall, StoredChatMessage } from '@/lib/chatTranscripts';

export const CALL_TOOL = 'make_phone_call';
export const CALL_REPORT_PREFIX = 'call-report-';
const POLL_MS = 5_000;
// Counted from the latest call still waited for.
const POLL_LIMIT_MS = 30 * 60_000;
// The server stamps reports with its clock; asking from a little earlier than
// ours keeps a skewed clock from hiding one. Ids make the overlap harmless.
const CLOCK_SLACK_MS = 5 * 60_000;

export const callReportId = (callSid: string) => `${CALL_REPORT_PREFIX}${callSid}`;
export const isCallReport = (messageId: string) => messageId.startsWith(CALL_REPORT_PREFIX);

export function callReportMessage(report: CallReport): StoredChatMessage {
  return {
    id: callReportId(report.call_sid),
    role: 'assistant',
    text: report.text,
    at: report.reported_at || report.created_at || new Date().toISOString(),
  };
}

/** `iso` moved back by the clock slack, for a `since`. */
export function sinceWithSlack(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t - CLOCK_SLACK_MS).toISOString();
}

/** The calls `t` placed whose report it does not hold yet. */
export function awaitedCalls(t: ChatTranscript): PlacedCall[] {
  const stored = new Set(t.messages.map(m => m.id));
  return (t.calls ?? []).filter(c => !stored.has(callReportId(c.callSid)));
}

/**
 * One request for the reports `t` lacks. A chat with a conversation of its own
 * owns every report there, including calls placed before chats noted them. The
 * identity's main web conversation is shared by older chats, so on it a chat
 * takes only the calls it placed, and asks nothing when it waits for none.
 */
export async function fetchMissingReports(t: ChatTranscript): Promise<CallReport[]> {
  const awaited = awaitedCalls(t);
  if (!t.conversationId && !awaited.length) return [];
  const from = t.conversationId
    ? t.createdAt
    : awaited.reduce((min, c) => (c.at < min ? c.at : min), awaited[0].at);
  const reports = await fetchCallReports(t.conversationId, sinceWithSlack(from));
  const stored = new Set(t.messages.map(m => m.id));
  const placed = new Set((t.calls ?? []).map(c => c.callSid));
  return reports.filter(
    r => !stored.has(callReportId(r.call_sid)) && (t.conversationId !== undefined || placed.has(r.call_sid)),
  );
}

export interface WatchOptions {
  /** The chat's transcript, read again on every tick: what it already holds,
   * however it got there (this watch, a catch-up, another tab), is not waited for. */
  transcript: () => Promise<ChatTranscript | null>;
  /** Stores the reports the chat lacks. */
  onReports: (reports: CallReport[]) => Promise<void>;
  signal: AbortSignal;
  intervalMs?: number;
  limitMs?: number;
  now?: () => number;
}

/** Why a watch ended: every awaited report is stored, the limit passed, or it was stopped. */
export type WatchEnd = 'done' | 'gave-up' | 'aborted';

/**
 * Poll until the chat holds the reports of all the calls it placed, the limit
 * has passed since the latest of them, or `signal` aborts. A failed request is
 * retried on the next tick: a deploy restarting Pincer is exactly when a
 * report is waited for.
 */
export async function watchCallReports({
  transcript,
  onReports,
  signal,
  intervalMs = POLL_MS,
  limitMs = POLL_LIMIT_MS,
  now = Date.now,
}: WatchOptions): Promise<WatchEnd> {
  const read = () => transcript().catch(() => null);
  for (;;) {
    const t = await read();
    if (signal.aborted) return 'aborted';
    const awaited = t ? awaitedCalls(t) : [];
    if (!awaited.length) return 'done';
    const latest = Math.max(...awaited.map(c => Date.parse(c.at) || 0));
    if (now() - latest >= limitMs) return 'gave-up';
    await wait(intervalMs, signal);
    if (signal.aborted) return 'aborted';
    try {
      const current = await read();
      const fresh = current ? await fetchMissingReports(current) : [];
      if (signal.aborted) return 'aborted';
      if (fresh.length) await onReports(fresh);
    } catch {
      /* asked again on the next tick */
    }
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}
