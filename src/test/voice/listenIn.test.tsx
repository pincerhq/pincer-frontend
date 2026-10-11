/**
 * Live listen-in (S15 §5, frontend half).
 *
 * Two things are worth pinning: the μ-law decode, which is exact and would
 * otherwise fail as quiet distortion nobody can debug; and the session state
 * machine, where the interesting cases are all failures — the listener cap, a
 * dropped socket, the call ending under you.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MULAW_TABLE, base64ToBytes, decodeMulaw, mulawToFloat, peakLevel } from '@/components/voice/listen/mulaw';
import {
  CLOSE_CAPACITY,
  ListenClient,
  listenTicketPath,
  listenUrl,
  type ListenClientEvents,
  type ListenEndReason,
  type ListenState,
} from '@/components/voice/listen/listenClient';

vi.mock('@/lib/pincerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pincerClient')>();
  return { ...actual, getAuth: () => ({ apiUrl: 'https://pincer.test', token: 'tok_123' }) };
});

// ── A socket the test drives ─────────────────────────────────────────

class FakeSocket {
  static last: FakeSocket | null = null;
  static made = 0;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  sent: unknown[] = [];

  constructor(public url: string, public protocols?: string[]) {
    FakeSocket.last = this;
    FakeSocket.made += 1;
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  emit(msg: unknown) {
    this.onmessage?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) });
  }
  drop(code = 1006) {
    this.onclose?.({ code });
  }
}

const makeClient = (events: Partial<ListenClientEvents> = {}) => {
  const states: ListenState[] = [];
  const ends: { reason: ListenEndReason; detail?: string }[] = [];
  const frames: { track: string; payload: string }[] = [];
  const client = new ListenClient(
    'CA1',
    {
      onState: (s) => states.push(s),
      onFrame: (f) => frames.push(f),
      onEnd: (reason, detail) => ends.push({ reason, detail }),
      ...events,
    },
    (url, ...rest: unknown[]) => new FakeSocket(url, rest[0] as string[] | undefined) as unknown as WebSocket,
    async (callSid) => {
      tickets.push(callSid);
      return `ticket-${tickets.length}`;
    },
  );
  return { client, states, ends, frames };
};

/** Every call sid a ticket was asked for, in order. */
const tickets: string[] = [];

/** The ticket is fetched first, so the socket exists one turn after connect(). */
const opened = () => vi.waitFor(() => expect(FakeSocket.last).not.toBeNull());

beforeEach(() => {
  FakeSocket.last = null;
  FakeSocket.made = 0;
  tickets.length = 0;
});

describe('μ-law decoding', () => {
  it('matches the G.711 reference points', () => {
    // Silence is 0xFF/0x7F; full scale sits at the ends of the table.
    expect(MULAW_TABLE[0xff]).toBe(0);
    // 0x7F is the negative half's silence — the same zero, other sign bit.
    expect(Math.abs(MULAW_TABLE[0x7f])).toBe(0);
    expect(MULAW_TABLE[0x00]).toBe(-32124);
    expect(MULAW_TABLE[0x80]).toBe(32124);
    // The step nearest silence is 8, and the table is symmetric about it.
    expect(MULAW_TABLE[0xfe]).toBe(8);
    expect(MULAW_TABLE[0x7e]).toBe(-8);
    expect(MULAW_TABLE[0xfd]).toBe(16);
  });

  it('is monotonic away from silence, in both halves', () => {
    for (let i = 0x80; i < 0xff; i++) expect(MULAW_TABLE[i]).toBeGreaterThan(MULAW_TABLE[i + 1]);
    for (let i = 0x00; i < 0x7f; i++) expect(MULAW_TABLE[i]).toBeLessThan(MULAW_TABLE[i + 1]);
  });

  it('normalises into [-1, 1]', () => {
    for (let i = 0; i < 256; i++) {
      const v = mulawToFloat(i);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(mulawToFloat(0xff)).toBe(0);
    expect(mulawToFloat(0x80)).toBeCloseTo(0.98, 2);
  });

  it('decodes a frame and reports its peak', () => {
    const bytes = new Uint8Array([0xff, 0x80, 0xff, 0x00]);
    const pcm = decodeMulaw(bytes);
    expect(pcm).toHaveLength(4);
    expect(pcm[0]).toBe(0);
    expect(peakLevel(pcm)).toBeCloseTo(0.98, 2);
    expect(peakLevel(decodeMulaw(new Uint8Array([0xff, 0xff])))).toBe(0);
  });

  it('reads base64 the way Twilio sends it', () => {
    // "/4D/AA==" is [0xFF, 0x80, 0xFF, 0x00].
    expect([...base64ToBytes('/4D/AA==')]).toEqual([0xff, 0x80, 0xff, 0x00]);
  });
});

describe('listen session', () => {
  it('connects to the call over WSS with a one-off ticket, never the session token', async () => {
    const { client, states } = makeClient();
    client.connect();
    expect(states).toEqual(['connecting']);
    await opened();

    expect(tickets).toEqual(['CA1']);
    expect(FakeSocket.last?.url).toBe('wss://pincer.test/api/voice/listen/CA1?token=ticket-1');
    // A bearer in a query string ends up in every proxy log there is.
    expect(FakeSocket.last?.url).not.toContain('tok_123');
    expect(FakeSocket.last?.protocols).toBeUndefined();
    expect(listenTicketPath('CA 9')).toBe('/api/voice/listen/CA%209/ticket');
    expect(listenUrl('http://localhost:8080', 'CA9', 'a b')).toBe('ws://localhost:8080/api/voice/listen/CA9?token=a%20b');
    // A backend with sign-in switched off hands out an empty ticket.
    expect(listenUrl('http://localhost:8080', 'CA9')).toBe('ws://localhost:8080/api/voice/listen/CA9');
  });

  it('reports an error when no ticket can be had', async () => {
    const ends: { reason: ListenEndReason; detail?: string }[] = [];
    const states: ListenState[] = [];
    const client = new ListenClient(
      'CA1',
      { onState: (s) => states.push(s), onFrame: () => {}, onEnd: (reason, detail) => ends.push({ reason, detail }) },
      (url) => new FakeSocket(url) as unknown as WebSocket,
      async () => {
        throw new Error('HTTP 401');
      },
    );
    client.connect();
    await vi.waitFor(() => expect(ends).toEqual([{ reason: 'error', detail: 'HTTP 401' }]));
    expect(states.at(-1)).toBe('error');
    expect(FakeSocket.made).toBe(0);
  });

  it('opens nothing when stopped before the ticket arrives', async () => {
    const { client } = makeClient();
    client.connect();
    client.close();
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeSocket.made).toBe(0);
  });

  it('plays frames once the server says it started', async () => {
    const { client, states, frames } = makeClient();
    client.connect();
    await opened();
    FakeSocket.last!.emit({ type: 'start', call_sid: 'CA1', tracks: ['inbound', 'outbound'] });
    FakeSocket.last!.emit({ type: 'media', track: 'inbound', payload: '/4D/AA==', ts: 1 });
    FakeSocket.last!.emit({ type: 'media', track: 'outbound', payload: '//8=', ts: 2 });

    expect(states).toEqual(['connecting', 'listening']);
    expect(frames.map((f) => f.track)).toEqual(['inbound', 'outbound']);
  });

  it('never sends anything: the architecture is receive-only', async () => {
    const { client } = makeClient();
    client.connect();
    await opened();
    FakeSocket.last!.emit({ type: 'start' });
    FakeSocket.last!.emit({ type: 'media', track: 'inbound', payload: '//8=' });
    client.close();

    expect(FakeSocket.last!.sent).toEqual([]);
  });

  it('says the listener cap was hit rather than retrying into it', async () => {
    const { client, ends } = makeClient();
    client.connect();
    await opened();
    FakeSocket.last!.drop(CLOSE_CAPACITY);

    expect(ends).toEqual([{ reason: 'capacity', detail: undefined }]);
    expect(FakeSocket.made).toBe(1);
  });

  it('ends when the call does, with the reason the server gave', async () => {
    const { client, states, ends } = makeClient();
    client.connect();
    await opened();
    FakeSocket.last!.emit({ type: 'start' });
    FakeSocket.last!.emit({ type: 'end', reason: 'call_ended' });

    expect(ends[0].reason).toBe('call_ended');
    expect(states.at(-1)).toBe('ended');
    expect(FakeSocket.last!.closed).toBe(true);
  });

  it('retries a dropped socket exactly once, then stops', async () => {
    const { client, states, ends } = makeClient();
    client.connect();
    await opened();
    FakeSocket.last!.emit({ type: 'start' });

    FakeSocket.last!.drop(1006);
    expect(states).toContain('reconnecting');
    // The retry is a new socket, so it needs a ticket of its own.
    await vi.waitFor(() => expect(FakeSocket.made).toBe(2));
    expect(FakeSocket.last!.url).toContain('token=ticket-2');

    // The second drop is the end of it — no loop.
    FakeSocket.last!.drop(1006);
    expect(FakeSocket.made).toBe(2);
    expect(ends.at(-1)?.reason).toBe('error');
    expect(states.at(-1)).toBe('error');
  });

  it('counts listeners when the server reports them', async () => {
    const counts: number[] = [];
    const { client } = makeClient({ onListeners: (n) => void counts.push(n) });
    client.connect();
    await opened();
    FakeSocket.last!.emit({ type: 'start', listener_count: 1 });
    FakeSocket.last!.emit({ type: 'listeners', listener_count: 2 });

    expect(counts).toEqual([1, 2]);
  });

  it('ignores a frame it cannot parse instead of dying on it', async () => {
    const { client, ends } = makeClient();
    client.connect();
    await opened();
    FakeSocket.last!.emit('not json');
    expect(ends).toEqual([]);
  });
});

// ── The surface ──────────────────────────────────────────────────────

const { default: ListenIn } = await import('@/components/voice/listen/ListenIn');

const activeCall = (over: Record<string, unknown> = {}) => ({
  call_sid: 'CA1',
  direction: 'inbound',
  caller_number: '+4930111222',
  target_number: '',
  target_name: '',
  purpose: '',
  engine: 'conversation_relay',
  duration_seconds: 12,
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe('listen control', () => {
  it('offers nothing when the backend cannot serve this call', () => {
    const { container } = render(<ListenIn call={activeCall() as never} />);
    // No endpoint, no surface — and no promise of one.
    expect(container.innerHTML).toBe('');
  });

  it('offers a button when the call can be listened to', () => {
    render(<ListenIn call={activeCall({ listen_available: true, listener_count: 2 }) as never} />);
    expect(screen.getByRole('button', { name: /listen/i })).toBeInTheDocument();
    expect(screen.getByText('· 2')).toBeInTheDocument();
  });

  it('starts only from the click, and says so when the browser cannot play', async () => {
    const user = userEvent.setup();
    render(<ListenIn call={activeCall({ listen_available: true }) as never} />);

    // jsdom has no AudioWorklet: the honest answer is that it cannot play,
    // not a silent player that looks like it is working.
    await user.click(screen.getByRole('button', { name: /listen/i }));
    expect(
      await screen.findByText(/cannot play the live audio/i),
    ).toBeInTheDocument();
  });
});
