/**
 * The listen-in session: one WebSocket, one state machine, no audio.
 *
 * Kept apart from both the React surface and the audio graph so the part that
 * decides *what happens* — capacity, call end, a dropped socket, the single
 * reconnect — can be tested without a browser audio stack, and so the player
 * cannot accidentally grow a second, different idea of the same states.
 *
 * Listen-only is a property of the architecture (the server subscribes us to a
 * receive-only media fork), so this client never sends anything but the close.
 */
import { authedFetch, getAuth } from '@/lib/pincerClient';

export type ListenState =
  | 'idle'
  | 'connecting'
  | 'listening'
  /** The socket dropped once and we are trying again, silently. */
  | 'reconnecting'
  | 'ended'
  | 'error';

/** Why a session finished. The UI says something different for each. */
export type ListenEndReason = 'call_ended' | 'capacity' | 'error' | 'stopped';

export type ListenTrack = 'inbound' | 'outbound';

export interface ListenFrame {
  track: ListenTrack;
  /** base64 μ-law, exactly as Twilio sent it. */
  payload: string;
  ts?: number;
}

export interface ListenClientEvents {
  onState: (state: ListenState) => void;
  onFrame: (frame: ListenFrame) => void;
  onEnd: (reason: ListenEndReason, detail?: string) => void;
  onListeners?: (count: number) => void;
}

/** Close code the server uses when the per-call listener cap is reached (§3.3). */
export const CLOSE_CAPACITY = 4001;

/**
 * A browser cannot set an Authorization header on a WebSocket, and the session
 * token must not ride a URL that ends up in access logs. So the socket is
 * opened with a ticket instead: one minute, single call, minted by
 * `POST /api/voice/listen/{call_sid}/ticket` for the signed-in session.
 */
export function listenTicketPath(callSid: string): string {
  return `/api/voice/listen/${encodeURIComponent(callSid)}/ticket`;
}

export function listenUrl(apiUrl: string, callSid: string, ticket = ''): string {
  const base = apiUrl.replace(/^http/i, 'ws');
  const url = `${base}/api/voice/listen/${encodeURIComponent(callSid)}`;
  // An empty ticket is what a backend with sign-in switched off hands out.
  return ticket ? `${url}?token=${encodeURIComponent(ticket)}` : url;
}

async function fetchListenTicket(callSid: string): Promise<string> {
  const res = await authedFetch(listenTicketPath(callSid), { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { ticket?: unknown };
  return typeof body.ticket === 'string' ? body.ticket : '';
}

type SocketFactory = (url: string) => WebSocket;
type TicketSource = (callSid: string) => Promise<string>;

export class ListenClient {
  private ws: WebSocket | null = null;
  private state: ListenState = 'idle';
  /** One silent retry, then the error state — never a reconnect loop (§4.1). */
  private retried = false;
  private closedByUs = false;

  constructor(
    private readonly callSid: string,
    private readonly events: ListenClientEvents,
    private readonly makeSocket: SocketFactory = (url) => new WebSocket(url),
    private readonly getTicket: TicketSource = fetchListenTicket,
  ) {}

  get currentState(): ListenState {
    return this.state;
  }

  private setState(next: ListenState) {
    if (this.state === next) return;
    this.state = next;
    this.events.onState(next);
  }

  /** Starts the session. Only ever called from a click — see ListenIn.tsx. */
  connect(): void {
    const auth = getAuth();
    if (!auth) {
      this.setState('error');
      this.events.onEnd('error', 'Not connected to a Pincer backend');
      return;
    }

    this.setState(this.retried ? 'reconnecting' : 'connecting');
    void this.open(auth.apiUrl);
  }

  /** A ticket is single-use, so every attempt (the one retry too) gets its own. */
  private async open(apiUrl: string): Promise<void> {
    let ws: WebSocket;
    try {
      const ticket = await this.getTicket(this.callSid);
      // Stopped while the ticket was on its way: there is nothing to open.
      if (this.closedByUs) return;
      ws = this.makeSocket(listenUrl(apiUrl, this.callSid, ticket));
    } catch (err) {
      if (this.closedByUs) return;
      this.setState('error');
      this.events.onEnd('error', err instanceof Error ? err.message : String(err));
      return;
    }
    this.ws = ws;

    ws.onmessage = (ev) => this.handle(ev.data);
    ws.onerror = () => {
      /* onclose carries the outcome; an error alone is not a state. */
    };
    ws.onclose = (ev) => this.handleClose(ev.code);
  }

  private handle(raw: unknown) {
    if (typeof raw !== 'string') return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // a frame we cannot read is a dropped frame, not a dead session
    }

    switch (msg.type) {
      case 'start':
        this.retried = false;
        this.setState('listening');
        if (typeof msg.listener_count === 'number') this.events.onListeners?.(msg.listener_count);
        return;
      case 'media': {
        const track = msg.track === 'outbound' ? 'outbound' : 'inbound';
        if (typeof msg.payload !== 'string') return;
        this.setState('listening');
        this.events.onFrame({ track, payload: msg.payload, ts: msg.ts as number | undefined });
        return;
      }
      case 'listeners':
        if (typeof msg.listener_count === 'number') this.events.onListeners?.(msg.listener_count);
        return;
      case 'end': {
        const reason = (msg.reason as ListenEndReason) ?? 'call_ended';
        this.finish(reason);
        return;
      }
      default:
        return;
    }
  }

  private handleClose(code: number) {
    if (this.closedByUs || this.state === 'ended') return;

    if (code === CLOSE_CAPACITY) {
      this.finish('capacity');
      return;
    }
    // A drop before the server said why: try once, quietly.
    if (!this.retried) {
      this.retried = true;
      this.connect();
      return;
    }
    this.setState('error');
    this.events.onEnd('error');
  }

  private finish(reason: ListenEndReason) {
    this.setState(reason === 'error' ? 'error' : 'ended');
    this.events.onEnd(reason);
    this.close(true);
  }

  /** Stop listening. `internal` marks a close the session itself decided on. */
  close(internal = false): void {
    this.closedByUs = true;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* already gone */
      }
    }
    if (!internal) {
      this.setState('idle');
      this.events.onEnd('stopped');
    }
  }
}
