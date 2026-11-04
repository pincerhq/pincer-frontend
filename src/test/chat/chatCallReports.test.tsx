/**
 * A phone call placed from web chat reports back into that chat
 * (pincerhq/pincer#303). Web chat has no push path: a turn that placed a call
 * names its SID, the chat notes it, polls `/api/chat/call-reports` until that
 * report arrives, stores it once under a stable id, and stops. A chat takes
 * only the reports of the calls it placed when its conversation is shared.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createStore, set } from 'idb-keyval';
import type { CallReport, StreamEvent } from '@/lib/pincerClient';
import type { ChatTranscript } from '@/lib/chatTranscripts';

let owner = '';
// A turn's frames; a promise holds the stream there until it resolves.
type Step = StreamEvent | Promise<void>;
let scripts: Step[][] = [];
let fallbackReply: { reply: string; call_sids?: string[] } = { reply: 'fallback reply' };
// What the server holds: reports by the conversation they were placed from
// (undefined is the identity's main web conversation). Every request is kept.
let server: Array<{ conversationId?: string; report: CallReport }> = [];
const polls: Array<{ conversationId?: string; since?: string }> = [];
let pollLimitMs = 60_000;

vi.mock('@/lib/capabilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities')>();
  return {
    ...actual,
    useHealth: () => ({ status: 'success', data: { status: 'ok' }, isError: false, isSuccess: true, fetchStatus: 'idle', dataUpdatedAt: Date.now(), errorUpdatedAt: 0 }),
  };
});

vi.mock('@/lib/pincerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pincerClient')>();
  return {
    ...actual,
    isConnected: () => true,
    getAuth: () => ({
      apiUrl: 'http://pincer.test',
      token: 't',
      refreshToken: 'r',
      expiresAt: Date.now() + 3_600_000,
      userId: owner,
    }),
    sendChat: vi.fn(async () => fallbackReply),
    fetchCallReports: vi.fn(async (conversationId?: string, since?: string) => {
      polls.push({ conversationId, since });
      return server
        .filter(s => s.conversationId === conversationId && (!since || s.report.reported_at >= since))
        .map(s => s.report);
    }),
    streamChat: async function* (): AsyncGenerator<StreamEvent> {
      const script = scripts.shift();
      if (!script) throw new Error('no script for this turn');
      for (const step of script) {
        await Promise.resolve();
        if (step instanceof Promise) await step;
        else yield step;
      }
    },
  };
});

// Poll every 20 ms instead of every 5 s.
vi.mock('@/lib/callReports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/callReports')>();
  return {
    ...actual,
    watchCallReports: (opts: Parameters<typeof actual.watchCallReports>[0]) =>
      actual.watchCallReports({ ...opts, intervalMs: 20, limitMs: pollLimitMs }),
  };
});

vi.mock('@/lib/api/conversations', () => ({
  listConversations: async () => ({ conversations: [], limit: 50, offset: 0 }),
}));

const { default: Chat } = await import('@/pages/Chat');
const { getTranscript, listTranscripts } = await import('@/lib/chatTranscripts');
const { callReportId, isCallReport } = await import('@/lib/callReports');

const report = (callSid: string, text: string): CallReport => ({
  call_sid: callSid,
  outcome: 'no-answer',
  text,
  created_at: new Date().toISOString(),
  reported_at: new Date().toISOString(),
});
const REPORT = report('CA123', "📞 Couldn't reach Dentist — nobody answered.");

const dialTurn = (callSid: string | undefined, text = 'Calling the dentist now.'): Step[] => [
  { event: 'tool', data: { phase: 'start', name: 'make_phone_call' } },
  { event: 'tool', data: { phase: 'done', name: 'make_phone_call', ...(callSid ? { call_sid: callSid } : {}) } },
  { event: 'chunk', data: { delta: text } },
  { event: 'done', data: { text } },
];

const renderChat = () =>
  render(
    <MemoryRouter initialEntries={['/chat']}>
      <Chat />
    </MemoryRouter>,
  );

const main = () => within(screen.getByRole('main'));
const input = () => screen.getByPlaceholderText(/Message AI assistant/);
const sidebarChat = (title: string) => screen.getByRole('button', { name: title });

async function send(text: string, script: Step[], answer?: string) {
  scripts.push(script);
  await waitFor(() => expect(input()).not.toBeDisabled());
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.keyDown(input(), { key: 'Enter' });
  if (answer) await main().findByText(answer);
}

const storedReports = async () =>
  (await listTranscripts(owner)).flatMap(t => t.messages.filter(m => isCallReport(m.id)).map(m => [t.id, m.id]));

/** The dial is noted in the transcript (written after its frame, not awaited by the turn). */
const callNoted = (callSid: string) =>
  waitFor(async () => expect((await listTranscripts(owner))[0].calls?.map(c => c.callSid)).toContain(callSid));

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Polls stopped: no request goes out for a while. */
async function expectPollsStopped() {
  const settled = polls.length;
  await pause(120);
  expect(polls.length).toBe(settled);
}

/** A chat stored before chats had their own conversation: it talks on the main one. */
async function seedOlderChat(id: string, question: string, updatedAt: string, extra: Partial<ChatTranscript> = {}) {
  await set(
    `${owner}/${id}`,
    {
      id,
      ownerId: owner,
      createdAt: updatedAt,
      updatedAt,
      messages: [{ id: `${id}-q`, role: 'user', text: question, at: updatedAt }],
      ...extra,
    } satisfies ChatTranscript,
    createStore('pincer-chat', 'transcripts'),
  );
}

beforeEach(() => {
  owner = crypto.randomUUID();
  scripts = [];
  server = [];
  polls.length = 0;
  pollLimitMs = 60_000;
  fallbackReply = { reply: 'fallback reply' };
});

afterEach(() => {
  cleanup();
});

describe('call reports in web chat', () => {
  it('polls after a placed call, appends its report once, then stops', async () => {
    renderChat();
    await send('call the dentist', dialTurn('CA123'), 'Calling the dentist now.');
    await main().findByText('Waiting for the call result…');

    // Ringing: polls come back empty, nothing is added.
    await waitFor(() => expect(polls.length).toBeGreaterThanOrEqual(2));
    expect(main().queryByText(REPORT.text)).not.toBeInTheDocument();

    const [transcript] = await listTranscripts(owner);
    server.push({ conversationId: transcript.conversationId, report: REPORT });
    await main().findByText(REPORT.text);

    expect(polls.at(-1)?.conversationId).toBe(transcript.conversationId);
    await waitFor(async () =>
      expect(await storedReports()).toEqual([[transcript.id, callReportId('CA123')]]),
    );
    await expectPollsStopped();
    expect(main().getAllByText(REPORT.text)).toHaveLength(1);
    expect(main().queryByText('Waiting for the call result…')).not.toBeInTheDocument();
  });

  it('starts no poll after a dial that was refused or failed', async () => {
    renderChat();
    await send('call the dentist', dialTurn(undefined, 'The daily call limit is reached.'), 'The daily call limit is reached.');
    await pause(100);
    expect(polls).toEqual([]);
    expect((await listTranscripts(owner))[0].calls).toBeUndefined();
  });

  it('does not poll after other tools', async () => {
    renderChat();
    await send(
      'what is the weather',
      [
        { event: 'tool', data: { phase: 'start', name: 'web_search' } },
        { event: 'tool', data: { phase: 'done', name: 'web_search' } },
        { event: 'done', data: { text: 'Sunny.' } },
      ],
      'Sunny.',
    );
    await pause(100);
    // A new chat has nothing to catch up on, and only a placed call starts a poll.
    expect(polls).toEqual([]);
  });

  it('keeps polling after the first of two calls reports, until the second does', async () => {
    renderChat();
    await send('call the dentist', dialTurn('CA1'), 'Calling the dentist now.');
    await send('and the plumber', dialTurn('CA2', 'Calling the plumber now.'), 'Calling the plumber now.');
    const [transcript] = await listTranscripts(owner);

    server.push({ conversationId: transcript.conversationId, report: report('CA1', 'dentist report') });
    await main().findByText('dentist report');
    const before = polls.length;
    await pause(100);
    expect(polls.length).toBeGreaterThan(before);

    server.push({ conversationId: transcript.conversationId, report: report('CA2', 'plumber report') });
    await main().findByText('plumber report');
    await expectPollsStopped();
  });

  it('takes a report stored by the catch-up as arrived and stops the poll', async () => {
    renderChat();
    await send('call the dentist', dialTurn('CA123'), 'Calling the dentist now.');
    const [callChat] = await listTranscripts(owner);

    // Another chat is open when the report lands; reopening the first one
    // stores it through the catch-up, not through the poll.
    fireEvent.click(screen.getAllByRole('button', { name: /new chat/i })[0]);
    await send('something else', [{ event: 'done', data: { text: 'other answer' } }], 'other answer');
    server.push({ conversationId: callChat.conversationId, report: REPORT });
    fireEvent.click(sidebarChat('call the dentist'));
    await main().findByText(REPORT.text);

    await waitFor(async () => expect(await storedReports()).toEqual([[callChat.id, callReportId('CA123')]]));
    await expectPollsStopped();
  });

  it('catches up on a report that arrived while the chat was closed, without duplicating it', async () => {
    const first = renderChat();
    await send('call the dentist', dialTurn('CA123'), 'Calling the dentist now.');
    await callNoted('CA123');
    first.unmount();

    const [transcript] = await listTranscripts(owner);
    server.push({ conversationId: transcript.conversationId, report: REPORT });
    renderChat();
    await main().findByText(REPORT.text);

    // Opening it again finds the report already stored.
    cleanup();
    renderChat();
    await main().findByText(REPORT.text);
    await waitFor(async () => expect(await storedReports()).toHaveLength(1));
    const stored = await getTranscript(owner, transcript.id);
    expect(stored?.messages.at(-1)?.id).toBe(callReportId('CA123'));
    expect(main().getAllByText(REPORT.text)).toHaveLength(1);
  });

  it('keeps waiting after a reload while the call is still ringing', async () => {
    const first = renderChat();
    await send('call the dentist', dialTurn('CA123'), 'Calling the dentist now.');
    await callNoted('CA123');
    first.unmount();

    renderChat();
    await main().findByText('Calling the dentist now.');
    await main().findByText('Waiting for the call result…');
    const before = polls.length;
    await waitFor(() => expect(polls.length).toBeGreaterThan(before + 1));

    const [transcript] = await listTranscripts(owner);
    server.push({ conversationId: transcript.conversationId, report: REPORT });
    await main().findByText(REPORT.text);
    await expectPollsStopped();
  });

  it('waits for a call placed through the non-streamed fallback', async () => {
    fallbackReply = { reply: 'Calling the dentist now.', call_sids: ['CA123'] };
    renderChat();
    // An empty script: the stream ends before its first frame.
    await send('call the dentist', [], 'Calling the dentist now.');
    await waitFor(() => expect(polls.length).toBeGreaterThanOrEqual(1));

    const [transcript] = await listTranscripts(owner);
    expect(transcript.calls?.map(c => c.callSid)).toEqual(['CA123']);
    server.push({ conversationId: transcript.conversationId, report: REPORT });
    await main().findByText(REPORT.text);
  });

  it('stores a report that lands mid-turn after the reply it follows', async () => {
    let finishReply!: () => void;
    const replyHeld = new Promise<void>(r => (finishReply = r));
    renderChat();
    await send('call the dentist', [
      { event: 'tool', data: { phase: 'start', name: 'make_phone_call' } },
      { event: 'tool', data: { phase: 'done', name: 'make_phone_call', call_sid: 'CA123' } },
      { event: 'chunk', data: { delta: 'Calling the dentist now.' } },
      replyHeld,
      { event: 'done', data: { text: 'Calling the dentist now.' } },
    ]);
    await main().findByText(/Calling the dentist now/);
    const [transcript] = await listTranscripts(owner);
    server.push({ conversationId: transcript.conversationId, report: REPORT });
    // A poll sees the report while the reply is still streaming; it waits.
    const before = polls.length;
    await waitFor(() => expect(polls.length).toBeGreaterThan(before));
    await pause(60);
    expect(await storedReports()).toEqual([]);
    expect(main().queryByText(REPORT.text)).not.toBeInTheDocument();
    finishReply();

    await main().findByText(REPORT.text);
    await waitFor(async () => {
      const stored = await getTranscript(owner, transcript.id);
      expect(stored?.messages.map(m => [m.role, isCallReport(m.id)])).toEqual([
        ['user', false],
        ['assistant', false],
        ['assistant', true],
      ]);
    });
  });

  it('says so when the poll gives up', async () => {
    pollLimitMs = 60;
    renderChat();
    await send('call the dentist', dialTurn('CA123'), 'Calling the dentist now.');
    await main().findByText(/The call result hasn't arrived yet/);
    await expectPollsStopped();
  });
});

describe('call reports in older chats on the main web conversation', () => {
  it('takes only the reports of the calls the chat placed', async () => {
    // B is the most recent, so it opens at boot.
    await seedOlderChat('older-a', 'question in A', '2026-11-01T10:00:00.000Z', {
      calls: [{ callSid: 'CA_A', at: new Date().toISOString() }],
    });
    await seedOlderChat('older-b', 'question in B', '2026-11-02T10:00:00.000Z');
    // A's call reports on the shared conversation.
    server.push({ report: report('CA_A', 'report for A') });

    renderChat();
    await main().findByText('question in B');
    await send('call the dentist', dialTurn('CA_B'), 'Calling the dentist now.');
    await waitFor(() => expect(polls.length).toBeGreaterThanOrEqual(2));
    expect(polls.every(p => p.conversationId === undefined)).toBe(true);
    expect(main().queryByText('report for A')).not.toBeInTheDocument();

    server.push({ report: report('CA_B', 'report for B') });
    await main().findByText('report for B');
    await expectPollsStopped();

    fireEvent.click(sidebarChat('question in A'));
    await main().findByText('report for A');
    await waitFor(async () =>
      expect((await storedReports()).sort()).toEqual([
        ['older-a', callReportId('CA_A')],
        ['older-b', callReportId('CA_B')],
      ]),
    );
  });

  it('asks nothing on opening an older chat that placed no call', async () => {
    await seedOlderChat('older-a', 'question in A', '2026-11-01T10:00:00.000Z');
    server.push({ report: report('CA9', 'someone else’s report') });

    renderChat();
    await main().findByText('question in A');
    await pause(100);
    expect(polls).toEqual([]);
    expect(main().queryByText('someone else’s report')).not.toBeInTheDocument();
  });
});
