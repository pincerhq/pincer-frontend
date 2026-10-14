/**
 * Reopening a chat restores all of it.
 *
 * The bug: the sidebar listed `/api/conversations` memory records (one
 * user/assistant exchange each) as if they were conversations, and a reload
 * hydrated `limit=1` of them, so a reopened chat showed its last exchange
 * only. Transcripts are now kept whole in this browser (fake-indexeddb here),
 * and these tests drive the page against that store with the network mocked.
 */
// The transcript store is idb-keyval; jsdom has no indexedDB.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { StreamEvent } from '@/lib/pincerClient';
import type { Conversation } from '@/lib/api/conversations';

let owner = '';
// Each streamed turn plays the next script; a script is its frames in order.
// HOLD keeps the stream open until it is aborted, which fails it as fetch does.
const HOLD = 'hold';
let scripts: (StreamEvent | typeof HOLD)[][] = [];
// The conversation id each streamed turn was sent with, in order.
let sentIds: (string | undefined)[] = [];
// Lets a test hold or fail a transcript read.
let getHook: ((ownerId: string, id: string) => Promise<unknown>) | null = null;
// What `/api/conversations` lists: Pincer's own exchange records.
let pincerRecords: Conversation[] = [];
// Lets a test hold the result of a transcript listing (read before the hold).
let listHook: (() => Promise<unknown>) | null = null;

// Pincer answers its health check, so the composer is never locked offline.
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
    streamChat: async function* (
      _text: string,
      signal?: AbortSignal,
      conversationId?: string,
    ): AsyncGenerator<StreamEvent> {
      sentIds.push(conversationId);
      const script = scripts.shift();
      if (!script) throw new Error('no script for this turn');
      const aborted = () => new DOMException('The operation was aborted.', 'AbortError');
      for (const ev of script) {
        await Promise.resolve();
        if (signal?.aborted) throw aborted();
        if (ev === HOLD) {
          await new Promise((_, reject) => signal?.addEventListener('abort', () => reject(aborted())));
          continue;
        }
        yield ev;
      }
    },
  };
});

vi.mock('@/lib/chatTranscripts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/chatTranscripts')>();
  return {
    ...actual,
    getTranscript: async (ownerId: string, id: string) => {
      if (getHook) await getHook(ownerId, id);
      return actual.getTranscript(ownerId, id);
    },
    listTranscripts: async (ownerId: string) => {
      const list = await actual.listTranscripts(ownerId);
      const hook = listHook;
      listHook = null;
      if (hook) await hook();
      return list;
    },
  };
});

vi.mock('@/lib/api/conversations', () => ({
  listConversations: async () => ({ conversations: pincerRecords, limit: 50, offset: 0 }),
}));

const { default: Chat } = await import('@/pages/Chat');
const { getTranscript, listTranscripts, saveMessages } = await import('@/lib/chatTranscripts');
const { sendChat, PincerError } = await import('@/lib/pincerClient');

const reply = (text: string): StreamEvent[] => {
  const half = Math.ceil(text.length / 2);
  return [
    { event: 'chunk', data: { delta: text.slice(0, half) } },
    { event: 'chunk', data: { delta: text.slice(half) } },
    { event: 'done', data: { text } },
  ];
};

const renderChat = () =>
  render(
    <MemoryRouter initialEntries={['/chat']}>
      <Chat />
    </MemoryRouter>,
  );

const main = () => within(screen.getByRole('main'));
const input = () => screen.getByPlaceholderText(/Message AI assistant/);
const sidebarChat = (title: string) => screen.getByRole('button', { name: title });
const currentChat = () => screen.getByRole('button', { name: 'Current Chat' });
const highlighted = (el: HTMLElement) => el.className.includes('font-semibold');

/** Send `text` and wait until its streamed reply has settled and been stored. */
async function send(text: string, answer: string) {
  scripts.push(reply(answer));
  await waitFor(() => expect(input()).not.toBeDisabled());
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.keyDown(input(), { key: 'Enter' });
  await main().findByText(answer);
  await waitFor(() => expect(input()).not.toBeDisabled());
  // The sidebar refreshes after the reply is stored.
  await waitFor(async () => {
    const stored = (await listTranscripts(owner)).flatMap(t => t.messages.map(m => m.text));
    expect(stored).toContain(answer);
  });
}

/** Which of `texts` the page shows, top to bottom, once per time it shows them. */
function visibleTexts(texts: string[]): string[] {
  const wanted = new Set(texts);
  const out: string[] = [];
  const walker = document.createTreeWalker(screen.getByRole('main'), NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent?.trim() ?? '';
    if (wanted.has(t)) out.push(t);
  }
  return out;
}

const exchange = (tag: string, n: number) =>
  Array.from({ length: n }, (_, i) => [`${tag} question ${i + 1}`, `${tag} answer ${i + 1}`]).flat();

beforeEach(() => {
  owner = crypto.randomUUID();
  scripts = [];
  sentIds = [];
  getHook = null;
  listHook = null;
  pincerRecords = [];
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('chat transcript store', () => {
  it('keeps every message once, in the order written, across concurrent saves', async () => {
    const at = new Date().toISOString();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        saveMessages(owner, 'c1', [{ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', text: `t${i}`, at }]),
      ),
    );
    // Writing a message again replaces it rather than adding a second copy.
    await saveMessages(owner, 'c1', [{ id: 'm3', role: 'assistant', text: 't3 final', at }]);

    const t = await getTranscript(owner, 'c1');
    expect(t?.messages.map(m => m.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']);
    expect(t?.messages[3].text).toBe('t3 final');
  });

  it('scopes transcripts to the signed-in identity', async () => {
    const at = new Date().toISOString();
    await saveMessages(owner, 'mine', [{ id: 'a', role: 'user', text: 'mine', at }]);
    await saveMessages(crypto.randomUUID(), 'theirs', [{ id: 'b', role: 'user', text: 'theirs', at }]);
    expect((await listTranscripts(owner)).map(t => t.id)).toEqual(['mine']);
  });
});

describe('chat page history', () => {
  it('reopens a left conversation with every exchange, in order', async () => {
    renderChat();
    await send('alpha question 1', 'alpha answer 1');
    await send('alpha question 2', 'alpha answer 2');
    await send('alpha question 3', 'alpha answer 3');

    fireEvent.click(screen.getAllByRole('button', { name: /new chat/i })[0]);
    await waitFor(() => expect(main().queryByText('alpha answer 3')).not.toBeInTheDocument());

    fireEvent.click(sidebarChat('alpha question 1'));
    await main().findByText('alpha answer 3');
    expect(visibleTexts(exchange('alpha', 3))).toEqual(exchange('alpha', 3));
  });

  it('shows the same complete transcript after a reload', async () => {
    const first = renderChat();
    await send('beta question 1', 'beta answer 1');
    await send('beta question 2', 'beta answer 2');
    first.unmount();

    renderChat();
    await main().findByText('beta answer 2');
    expect(visibleTexts(exchange('beta', 2))).toEqual(exchange('beta', 2));
  });

  it('switches between two conversations without losing or mixing messages', async () => {
    renderChat();
    await send('alpha question 1', 'alpha answer 1');
    await send('alpha question 2', 'alpha answer 2');
    fireEvent.click(screen.getAllByRole('button', { name: /new chat/i })[0]);
    await send('gamma question 1', 'gamma answer 1');
    await send('gamma question 2', 'gamma answer 2');

    const all = [...exchange('alpha', 2), ...exchange('gamma', 2)];
    fireEvent.click(sidebarChat('alpha question 1'));
    await main().findByText('alpha answer 2');
    expect(visibleTexts(all)).toEqual(exchange('alpha', 2));

    fireEvent.click(currentChat());
    await main().findByText('gamma answer 2');
    expect(visibleTexts(all)).toEqual(exchange('gamma', 2));
  });

  it('continues a reopened conversation without overwriting what came before', async () => {
    renderChat();
    await send('alpha question 1', 'alpha answer 1');
    await send('alpha question 2', 'alpha answer 2');
    fireEvent.click(screen.getAllByRole('button', { name: /new chat/i })[0]);
    await send('gamma question 1', 'gamma answer 1');

    fireEvent.click(sidebarChat('alpha question 1'));
    await main().findByText('alpha answer 2');
    await send('alpha question 3', 'alpha answer 3');
    expect(visibleTexts(exchange('alpha', 3))).toEqual(exchange('alpha', 3));

    const [alpha] = (await listTranscripts(owner)).filter(t => t.messages[0].text === 'alpha question 1');
    expect(alpha.messages.map(m => m.text)).toEqual(exchange('alpha', 3));
  });

  it('sends each conversation to Pincer as its own, and a reopened one as itself', async () => {
    renderChat();
    await send('alpha question 1', 'alpha answer 1');
    await send('alpha question 2', 'alpha answer 2');
    fireEvent.click(screen.getAllByRole('button', { name: /new chat/i })[0]);
    await send('gamma question 1', 'gamma answer 1');
    fireEvent.click(sidebarChat('alpha question 1'));
    await main().findByText('alpha answer 2');
    await send('alpha question 3', 'alpha answer 3');

    const [alpha, alphaAgain, gamma, alphaReopened] = sentIds;
    const stored = await listTranscripts(owner);
    expect(alpha).toBe(stored.find(t => t.messages[0].text === 'alpha question 1')?.id);
    expect(alphaAgain).toBe(alpha);
    expect(gamma).toBe(stored.find(t => t.messages[0].text === 'gamma question 1')?.id);
    expect(gamma).not.toBe(alpha);
    expect(alphaReopened).toBe(alpha);
  });

  it('opens a conversation far longer than the old 20-record history page', async () => {
    const at = Date.now();
    const texts = exchange('long', 40);
    await saveMessages(
      owner,
      'long-chat',
      texts.map((text, i) => ({
        id: `m${i}`,
        role: i % 2 ? 'assistant' : 'user',
        text,
        at: new Date(at + i * 1000).toISOString(),
      })),
    );

    renderChat();
    await main().findByText('long answer 40');
    expect(visibleTexts(texts)).toEqual(texts);
  });

  it('stores a streamed reply once and whole, and reopens it without duplicates', async () => {
    const first = renderChat();
    await send('delta question 1', 'delta answer, streamed in two chunks');
    first.unmount();

    const [t] = await listTranscripts(owner);
    expect(t.messages.map(m => [m.role, m.text])).toEqual([
      ['user', 'delta question 1'],
      ['assistant', 'delta answer, streamed in two chunks'],
    ]);

    renderChat();
    await main().findByText('delta answer, streamed in two chunks');
    expect(main().getAllByText('delta answer, streamed in two chunks')).toHaveLength(1);
    expect(main().getAllByText('delta question 1')).toHaveLength(1);
  });

  it('drops a load that finishes after the person switched again', async () => {
    renderChat();
    await send('alpha question 1', 'alpha answer 1');
    fireEvent.click(screen.getAllByRole('button', { name: /new chat/i })[0]);
    await send('gamma question 1', 'gamma answer 1');

    const alphaId = (await listTranscripts(owner)).find(t => t.messages[0].text === 'alpha question 1')!.id;
    let releaseAlpha!: () => void;
    const alphaHeld = new Promise<void>(r => (releaseAlpha = r));
    getHook = async (_o, id) => {
      if (id === alphaId) await alphaHeld;
    };

    fireEvent.click(sidebarChat('alpha question 1'));
    fireEvent.click(currentChat());
    await main().findByText('gamma answer 1');
    releaseAlpha();
    await new Promise(r => setTimeout(r, 20));
    expect(main().queryByText('alpha answer 1')).not.toBeInTheDocument();
    expect(main().getByText('gamma answer 1')).toBeInTheDocument();
  });

  it('says so when a conversation cannot be loaded, and loads it on retry', async () => {
    renderChat();
    await send('alpha question 1', 'alpha answer 1');
    fireEvent.click(screen.getAllByRole('button', { name: /new chat/i })[0]);

    getHook = async () => {
      throw new Error('IndexedDB unavailable');
    };
    fireEvent.click(sidebarChat('alpha question 1'));
    expect(await main().findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(main().queryByText('alpha question 1')).not.toBeInTheDocument();
    expect(input()).toBeDisabled();

    getHook = null;
    fireEvent.click(main().getByRole('button', { name: /try again/i }));
    await main().findByText('alpha answer 1');
    expect(main().queryByText(/could not be loaded/i)).not.toBeInTheDocument();
  });

  it('lists the live chat once, as the highlighted Current Chat', async () => {
    renderChat();
    expect(highlighted(currentChat())).toBe(true);
    await send('omega question 1', 'omega answer 1');

    expect(highlighted(currentChat())).toBe(true);
    expect(screen.queryByRole('button', { name: 'omega question 1' })).not.toBeInTheDocument();

    // Once the person moves on, it is listed under Earlier again.
    fireEvent.click(screen.getAllByRole('button', { name: /new chat/i })[0]);
    expect(await screen.findByRole('button', { name: 'omega question 1' })).toBeInTheDocument();
    expect(highlighted(currentChat())).toBe(true);
  });

  it('does not store an error as the reply', async () => {
    vi.mocked(sendChat).mockRejectedValueOnce(new PincerError('backend down', 503));
    scripts.push([{ event: 'error', data: { message: 'stream broke' } }]);
    renderChat();
    await waitFor(() => expect(input()).not.toBeDisabled());
    fireEvent.change(input(), { target: { value: 'failing question' } });
    fireEvent.keyDown(input(), { key: 'Enter' });

    await main().findByText(/⚠️ backend down/);
    await waitFor(() => expect(input()).not.toBeDisabled());
    await new Promise(r => setTimeout(r, 20));
    const [t] = await listTranscripts(owner);
    expect((await getTranscript(owner, t.id))?.messages.map(m => [m.role, m.text])).toEqual([
      ['user', 'failing question'],
    ]);
  });

  it('does not store the partial text of a stopped reply', async () => {
    scripts.push([{ event: 'chunk', data: { delta: 'half an answ' } }, HOLD]);
    renderChat();
    await waitFor(() => expect(input()).not.toBeDisabled());
    fireEvent.change(input(), { target: { value: 'stopped question' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await main().findByText('half an answ');

    // Leaving the chat stops the stream.
    fireEvent.click(screen.getAllByRole('button', { name: /new chat/i })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'stopped question' }));
    await main().findByText('stopped question');
    await new Promise(r => setTimeout(r, 20));
    expect(main().queryByText('half an answ')).not.toBeInTheDocument();
    const [t] = await listTranscripts(owner);
    expect(t.messages.map(m => [m.role, m.text])).toEqual([['user', 'stopped question']]);
  });

  it('stays on a chat started before the boot load lands', async () => {
    const at = new Date().toISOString();
    await saveMessages(owner, 'old', [
      { id: 'o1', role: 'user', text: 'old question', at },
      { id: 'o2', role: 'assistant', text: 'old answer', at },
    ]);
    let releaseBoot!: () => void;
    const bootHeld = new Promise<void>(r => (releaseBoot = r));
    listHook = () => bootHeld;

    renderChat();
    await send('fresh question 1', 'fresh answer 1');
    releaseBoot();
    await new Promise(r => setTimeout(r, 20));
    expect(main().queryByText('old answer')).not.toBeInTheDocument();
    expect(visibleTexts(exchange('fresh', 1))).toEqual(exchange('fresh', 1));
  });

  it('stays on a new chat opened before the boot load lands', async () => {
    const at = new Date().toISOString();
    await saveMessages(owner, 'old', [
      { id: 'o1', role: 'user', text: 'old question', at },
      { id: 'o2', role: 'assistant', text: 'old answer', at },
    ]);
    let releaseBoot!: () => void;
    const bootHeld = new Promise<void>(r => (releaseBoot = r));
    listHook = () => bootHeld;

    renderChat();
    fireEvent.click(screen.getAllByRole('button', { name: /new chat/i })[0]);
    // The new chat's own sidebar refresh is not held; its listing shows `old`.
    await screen.findByRole('button', { name: 'old question' });
    releaseBoot();
    await new Promise(r => setTimeout(r, 20));
    expect(main().queryByText('old answer')).not.toBeInTheDocument();
  });
});

describe('exchanges Pincer stored', () => {
  beforeEach(() => {
    pincerRecords = [
      {
        id: 'x1', user_id: owner, category: 'exchange', tags: [], preview: 'legacy question',
        messages: [{ role: 'user', content: 'legacy question' }, { role: 'assistant', content: 'legacy answer' }],
        created_at: '2026-10-01T10:00:00Z',
      },
    ];
  });

  it('lists them beside the stored chats and opens one', async () => {
    renderChat();
    fireEvent.click(await screen.findByRole('button', { name: 'legacy question' }));
    await main().findByText('legacy answer');
    expect(visibleTexts(['legacy question', 'legacy answer'])).toEqual(['legacy question', 'legacy answer']);
  });

  it('continues one as a stored chat that keeps its exchange', async () => {
    renderChat();
    fireEvent.click(await screen.findByRole('button', { name: 'legacy question' }));
    await main().findByText('legacy answer');
    await send('follow-up question', 'follow-up answer');

    const texts = ['legacy question', 'legacy answer', 'follow-up question', 'follow-up answer'];
    expect(visibleTexts(texts)).toEqual(texts);
    const [t] = await listTranscripts(owner);
    expect(t.messages.map(m => m.text)).toEqual(texts);
  });
});
