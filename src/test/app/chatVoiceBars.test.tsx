/**
 * While dictating, the mic button is the stop button and shows live voice
 * bars driven by the microphone level (a local Web Audio analyser — nothing is
 * sent anywhere). Whenever listening stops, the stream, the audio context and
 * the animation frame are all released. Reduced motion, or no microphone
 * stream, gets a steady indicator and dictation still works.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const health = vi.fn();
const T0 = Date.now();
const OK = { status: 'success', data: { status: 'ok' }, isError: false, isSuccess: true, fetchStatus: 'idle', dataUpdatedAt: T0, errorUpdatedAt: 0 };
const DOWN = { status: 'error', data: { status: 'ok' }, isError: true, isSuccess: false, fetchStatus: 'idle', dataUpdatedAt: 0, errorUpdatedAt: T0 };

vi.mock('@/lib/capabilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities')>();
  return { ...actual, useHealth: () => health() };
});

vi.mock('@/lib/pincerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pincerClient')>();
  return {
    ...actual,
    isConnected: () => true,
    getAuth: () => ({ apiUrl: 'http://pincer.test', token: 't', refreshToken: 'r', expiresAt: Date.now() + 60_000, userId: 'alice' }),
    fetchLatestConversation: async () => null,
    streamChat: () => (async function* () {})(),
  };
});

vi.mock('@/lib/chatTranscripts', () => ({
  listTranscripts: async () => [],
  getTranscript: async () => null,
  saveMessages: async () => {},
}));

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {}
  stop() { this.onend?.(); }
  abort() { this.onend?.(); }
}

/** A microphone track and an analyser whose level the test sets. */
class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  stop() { this.readyState = 'ended'; }
}
let level = 0;
class FakeAnalyser {
  fftSize = 0;
  smoothingTimeConstant = 0;
  get frequencyBinCount() { return this.fftSize / 2; }
  getByteFrequencyData(arr: Uint8Array) { arr.fill(level); }
}
class FakeAudioContext {
  static all: FakeAudioContext[] = [];
  state: 'running' | 'closed' = 'running';
  constructor() { FakeAudioContext.all.push(this); }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createAnalyser() { return new FakeAnalyser(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

let tracks: FakeTrack[] = [];
const getUserMedia = vi.fn(async () => {
  const t = new FakeTrack();
  tracks.push(t);
  return { getTracks: () => [t] };
});

/** requestAnimationFrame under the test's control. */
let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const flushFrame = () => act(() => {
  const due = [...frames.values()];
  frames = new Map();
  due.forEach((cb) => cb(performance.now()));
});

const { default: Chat } = await import('@/pages/Chat');
const ui = () => (
  <MemoryRouter initialEntries={['/chat']}>
    <Chat />
  </MemoryRouter>
);
const mic = () => screen.getByRole('button', { name: 'Voice input' });
const heights = () => screen.getAllByTestId('voice-bar').map((b) => (b as HTMLElement).style.height);
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function setReducedMotion(on: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: on && q.includes('prefers-reduced-motion'),
    media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe('live voice bars while dictating', () => {
  const realMatchMedia = window.matchMedia;
  beforeEach(() => {
    health.mockReset();
    health.mockReturnValue(OK);
    tracks = [];
    level = 0;
    FakeAudioContext.all = [];
    frames = new Map();
    getUserMedia.mockClear();
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.AudioContext = FakeAudioContext;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { const id = nextFrame++; frames.set(id, cb); return id; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
    setReducedMotion(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.matchMedia = realMatchMedia;
    const w = window as unknown as Record<string, unknown>;
    delete w.SpeechRecognition;
    delete w.AudioContext;
  });

  // Something must have been opened, or "everything ended" is vacuously true.
  const released = () => {
    expect(tracks.length).toBeGreaterThan(0);
    expect(FakeAudioContext.all.length).toBeGreaterThan(0);
    expect(tracks.every((t) => t.readyState === 'ended')).toBe(true);
    expect(FakeAudioContext.all.every((c) => c.state === 'closed')).toBe(true);
    expect(frames.size).toBe(0);
  };

  it('shows level bars instead of a crossed-out mic, and they follow the level', async () => {
    render(ui());
    await userEvent.click(mic());
    await settle();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(mic().querySelector('.lucide-mic-off')).toBeNull();
    expect(mic()).toHaveAttribute('aria-pressed', 'true');
    expect(mic()).toHaveAttribute('title', 'Stop dictation');

    level = 0;
    flushFrame();
    const flat = heights();
    level = 255;
    flushFrame();
    const loud = heights();
    expect(new Set(flat).size).toBe(1);
    expect(loud.every((h, i) => parseFloat(h) > parseFloat(flat[i]))).toBe(true);
    level = 0;
    flushFrame();
    expect(heights()).toEqual(flat);
  });

  it('releases the stream, the audio context and the frame on a second click', async () => {
    render(ui());
    await userEvent.click(mic());
    await settle();
    flushFrame();
    await userEvent.click(mic());
    await settle();
    expect(tracks).toHaveLength(1);
    released();
  });

  it('releases everything on Send', async () => {
    const user = userEvent.setup();
    render(ui());
    await user.type(screen.getByRole('textbox'), 'hello');
    await user.click(mic());
    await settle();
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await settle();
    released();
  });

  it('releases everything when Pincer goes offline', async () => {
    const view = render(ui());
    await userEvent.click(mic());
    await settle();
    health.mockReturnValue(DOWN);
    view.rerender(ui());
    await settle();
    released();
  });

  it('releases everything on unmount', async () => {
    const view = render(ui());
    await userEvent.click(mic());
    await settle();
    view.unmount();
    await settle();
    released();
  });

  it('releases everything on a recognition error', async () => {
    render(ui());
    await userEvent.click(mic());
    await settle();
    act(() => {
      FakeRecognition.last!.onerror?.({ error: 'not-allowed' });
      FakeRecognition.last!.onend?.();
    });
    await settle();
    released();
  });

  it('releases a stream that arrives after listening already stopped', async () => {
    let resolve: (s: unknown) => void = () => {};
    getUserMedia.mockImplementationOnce(() => new Promise((r) => { resolve = r; }) as never);
    render(ui());
    await userEvent.click(mic());
    await userEvent.click(mic());
    const late = new FakeTrack();
    tracks.push(late);
    await act(async () => { resolve({ getTracks: () => [late] }); });
    await settle();
    expect(late.readyState).toBe('ended');
  });

  it('shows a steady indicator under reduced motion, without opening the microphone stream', async () => {
    setReducedMotion(true);
    render(ui());
    await userEvent.click(mic());
    await settle();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByTestId('voice-bars')).toHaveAttribute('data-steady', 'true');
    expect(frames.size).toBe(0);
  });

  // WebKit (Safari, and every iOS browser) ends speech recognition when a second
  // capture opens the microphone, so there the bars must not call getUserMedia.
  it('on WebKit, animates the bars with CSS only and never opens a second microphone stream', async () => {
    (window as unknown as Record<string, unknown>).GestureEvent = class {};
    try {
      render(ui());
      await userEvent.click(mic());
      await settle();
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(FakeAudioContext.all).toHaveLength(0);
      expect(screen.getByTestId('voice-bars')).toHaveAttribute('data-mode', 'css');
      expect(screen.getAllByTestId('voice-bar').every((b) => b.classList.contains('animate-pulse'))).toBe(true);
      expect(mic()).toHaveAttribute('aria-pressed', 'true');
    } finally {
      delete (window as unknown as Record<string, unknown>).GestureEvent;
    }
  });

  it('on WebKit with reduced motion, shows the steady indicator', async () => {
    (window as unknown as Record<string, unknown>).GestureEvent = class {};
    setReducedMotion(true);
    try {
      render(ui());
      await userEvent.click(mic());
      await settle();
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(screen.getByTestId('voice-bars')).toHaveAttribute('data-mode', 'steady');
    } finally {
      delete (window as unknown as Record<string, unknown>).GestureEvent;
    }
  });

  it('keeps dictating with a steady indicator when the microphone stream is refused', async () => {
    getUserMedia.mockImplementationOnce(async () => { throw new DOMException('denied', 'NotAllowedError'); });
    render(ui());
    await userEvent.click(mic());
    await settle();
    expect(screen.getByTestId('voice-bars')).toHaveAttribute('data-steady', 'true');
    act(() => FakeRecognition.last!.onresult?.({ results: [Object.assign([{ transcript: 'still works' }], { isFinal: true })] }));
    expect(screen.getByRole('textbox')).toHaveValue('still works');
  });
});
