/**
 * A phone call placed from web chat reports back into that chat
 * (pincerhq/pincer#303). Web chat has no push path: after a
 * `make_phone_call` finishes, the page polls `/api/chat/call-reports` until
 * the report arrives, stores it once under a stable id, and stops.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CallReport, StreamEvent } from '@/lib/pincerClient';

let owner = '';
let scripts: StreamEvent[][] = [];
// What the server answers each poll with, and every poll's arguments.
let serverReports: CallReport[] = [];
const polls: Array<{ conversationId?: string; since?: string }> = [];

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
    sendChat: vi.fn(async () => ({ reply: 'fallback reply' })),
    fetchCallReports: vi.fn(async (conversationId?: string, since?: string) => {
      polls.push({ conversationId, since });
      return serverReports;
    }),
    streamChat: async function* (): AsyncGenerator<StreamEvent> {
      const script = scripts.shift();
      if (!script) throw new Error('no script for this turn');
      for (const ev of script) {
        await Promise.resolve();
        yield ev;
      }
    },
  };
});

// Poll every 20 ms instead of every 5 s.
vi.mock('@/lib/callReports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/callReports')>();
  return {
    ...actual,
    pollCallReports: (opts: Parameters<typeof actual.pollCallReports>[0]) =>
      actual.pollCallReports({ ...opts, intervalMs: 20 }),
  };
});

vi.mock('@/lib/api/conversations', () => ({
  listConversations: async () => ({ conversations: [], limit: 50, offset: 0 }),
}));

const { default: Chat } = await import('@/pages/Chat');
const { getTranscript, listTranscripts } = await import('@/lib/chatTranscripts');

const REPORT: CallReport = {
  call_sid: 'CA123',
  outcome: 'no-answer',
  text: "📞 Couldn't reach Dentist — nobody answered.",
  created_at: '2026-11-02T10:00:00+00:00',
  reported_at: '2026-11-02T10:01:00+00:00',
};

const callTurn: StreamEvent[] = [
  { event: 'tool', data: { phase: 'start', name: 'make_phone_call' } },
  { event: 'tool', data: { phase: 'done', name: 'make_phone_call' } },
  { event: 'chunk', data: { delta: 'Calling the dentist now.' } },
  { event: 'done', data: { text: 'Calling the dentist now.' } },
];

const renderChat = () =>
  render(
    <MemoryRouter initialEntries={['/chat']}>
      <Chat />
    </MemoryRouter>,
  );

const main = () => within(screen.getByRole('main'));
const input = () => screen.getByPlaceholderText(/Message AI assistant/);

async function send(text: string, script: StreamEvent[], answer: string) {
  scripts.push(script);
  await waitFor(() => expect(input()).not.toBeDisabled());
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.keyDown(input(), { key: 'Enter' });
  await main().findByText(answer);
}

const storedReports = async () =>
  (await listTranscripts(owner)).flatMap(t => t.messages.filter(m => m.id.startsWith('call-report-')));

beforeEach(() => {
  owner = crypto.randomUUID();
  scripts = [];
  serverReports = [];
  polls.length = 0;
});

afterEach(() => {
  cleanup();
});

describe('call reports in web chat', () => {
  it('polls after make_phone_call, appends the report once, then stops', async () => {
    renderChat();
    await send('call the dentist', callTurn, 'Calling the dentist now.');

    // Ringing: polls come back empty, nothing is added.
    await waitFor(() => expect(polls.length).toBeGreaterThanOrEqual(2));
    expect(main().queryByText(REPORT.text)).not.toBeInTheDocument();

    serverReports = [REPORT];
    await main().findByText(REPORT.text);

    const [transcript] = await listTranscripts(owner);
    expect(polls.at(-1)?.conversationId).toBe(transcript.conversationId);
    expect(polls.at(-1)?.since).toBeTruthy();
    await waitFor(async () =>
      expect((await storedReports()).map(m => [m.id, m.role, m.text])).toEqual([
        ['call-report-CA123', 'assistant', REPORT.text],
      ]),
    );

    // The poll stopped: no more requests, and the report is shown once.
    const settled = polls.length;
    await new Promise(r => setTimeout(r, 120));
    expect(polls.length).toBe(settled);
    expect(main().getAllByText(REPORT.text)).toHaveLength(1);
  });

  it('catches up on a report that arrived while the chat was closed, without duplicating it', async () => {
    const first = renderChat();
    await send('call the dentist', callTurn, 'Calling the dentist now.');
    first.unmount();

    serverReports = [REPORT];
    renderChat();
    await main().findByText(REPORT.text);
    const [transcript] = await listTranscripts(owner);
    expect(polls.at(-1)?.conversationId).toBe(transcript.conversationId);

    // Opening it again finds the report already stored.
    cleanup();
    renderChat();
    await main().findByText(REPORT.text);
    await waitFor(async () => expect(await storedReports()).toHaveLength(1));
    const stored = await getTranscript(owner, transcript.id);
    expect(stored?.messages.at(-1)?.id).toBe('call-report-CA123');
    expect(main().getAllByText(REPORT.text)).toHaveLength(1);
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
    await new Promise(r => setTimeout(r, 100));
    // A new chat has nothing to catch up on, and only make_phone_call starts a poll.
    expect(polls).toEqual([]);
  });
});
