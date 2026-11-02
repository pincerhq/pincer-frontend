/**
 * Phone call reports in the web chat (pincerhq/pincer#303).
 *
 * When the agent places a call, the tool only says it is ringing; the outcome
 * comes minutes later. Telegram and WhatsApp get it pushed, but web chat is
 * request/response, so the page asks `/api/chat/call-reports` for it: every
 * few seconds after a `make_phone_call` finishes, and once when a chat opens.
 *
 * A report is stored in the transcript as an assistant message with the id
 * `call-report-<call_sid>`. `saveMessages` replaces by id, so a report polled
 * twice, or by two tabs, is still shown once.
 */

import { fetchCallReports, type CallReport } from '@/lib/pincerClient';
import type { StoredChatMessage } from '@/lib/chatTranscripts';

export const CALL_TOOL = 'make_phone_call';
export const CALL_REPORT_PREFIX = 'call-report-';
export const CALL_REPORT_POLL_MS = 5_000;
export const CALL_REPORT_POLL_LIMIT_MS = 30 * 60_000;
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

export interface PollOptions {
  /** The Pincer conversation; undefined is the identity's main web conversation. */
  conversationId: string | undefined;
  /** Message ids already in the transcript: their reports are not new. */
  knownIds: () => Set<string> | Promise<Set<string>>;
  /** Called with the reports not seen before; true when no more are awaited. */
  onReports: (reports: CallReport[]) => boolean | Promise<boolean>;
  signal: AbortSignal;
  intervalMs?: number;
  limitMs?: number;
  now?: () => number;
}

/**
 * Poll until `onReports` has the reports it waits for, the limit passes, or
 * `signal` aborts. A failed request is retried on the next tick: a
 * deploy restarting Pincer is exactly when a report is waited for.
 */
export async function pollCallReports({
  conversationId,
  knownIds,
  onReports,
  signal,
  intervalMs = CALL_REPORT_POLL_MS,
  limitMs = CALL_REPORT_POLL_LIMIT_MS,
  now = Date.now,
}: PollOptions): Promise<void> {
  const started = now();
  const since = sinceWithSlack(new Date(started).toISOString());
  while (!signal.aborted && now() - started < limitMs) {
    await wait(intervalMs, signal);
    if (signal.aborted) return;
    let reports: CallReport[];
    try {
      reports = await fetchCallReports(conversationId, since);
    } catch {
      continue;
    }
    if (signal.aborted) return;
    let known: Set<string>;
    try {
      known = await knownIds();
    } catch {
      known = new Set();
    }
    const fresh = reports.filter(r => !known.has(callReportId(r.call_sid)));
    if (fresh.length && (await onReports(fresh))) return;
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
