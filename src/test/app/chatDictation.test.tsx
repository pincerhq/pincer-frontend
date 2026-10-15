/**
 * The mic dictates into the message box with the browser's Web Speech API:
 * interim and final words land after whatever was typed, nothing is ever sent
 * by dictation, and listening stops on a second click, on Send, on leaving the
 * page and when Pincer goes offline. No API → no mic button.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';

const health = vi.fn();
const streamChat = vi.fn((..._args: unknown[]) => (async function* () {})());

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
    streamChat: (...args: unknown[]) => streamChat(...args),
  };
});

vi.mock('@/lib/api/conversations', () => ({
  listConversations: async () => ({ conversations: [], limit: 20, offset: 0 }),
}));

/** A scriptable stand-in for the browser's SpeechRecognition. */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  calls: string[] = [];
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() { this.calls.push('start'); }
  stop() { this.calls.push('stop'); this.onend?.(); }
  abort() { this.calls.push('abort'); this.onend?.(); }
  /** Emit the session's results so far, as [transcript, isFinal] pairs. */
  emit(results: Array<[string, boolean]>) {
    const list = results.map(([transcript, isFinal]) => Object.assign([{ transcript, confidence: 0.9 }], { isFinal }));
    act(() => this.onresult?.({ resultIndex: 0, results: list }));
  }
  fail(error: string) {
    act(() => {
      this.onerror?.({ error });
      this.onend?.();
    });
  }
}
const last = () => FakeRecognition.instances.at(-1)!;

const { default: Chat } = await import('@/pages/Chat');

const ui = () => (
  <MemoryRouter initialEntries={['/chat']}>
    <Chat />
  </MemoryRouter>
);
const box = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const mic = () => screen.getByRole('button', { name: 'Voice input' });

describe('chat dictation', () => {
  beforeEach(() => {
    FakeRecognition.instances = [];
    health.mockReset();
    health.mockReturnValue(OK);
    streamChat.mockClear();
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
  });
  afterEach(async () => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    await act(() => i18n.changeLanguage('en'));
  });

  it('hides the mic when the browser has no speech recognition', () => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    render(ui());
    expect(screen.queryByRole('button', { name: 'Voice input' })).not.toBeInTheDocument();
  });

  it('uses the prefixed webkitSpeechRecognition when that is all there is', async () => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    render(ui());
    await userEvent.click(mic());
    expect(last().calls).toEqual(['start']);
  });

  it('starts listening in the UI language, continuous with interim results', async () => {
    render(ui());
    await userEvent.click(mic());
    expect(last()).toMatchObject({ lang: 'en-US', continuous: true, interimResults: true });
    expect(last().calls).toEqual(['start']);
    expect(mic()).toHaveAttribute('aria-pressed', 'true');
  });

  it('follows German when the UI is German', async () => {
    await act(() => i18n.changeLanguage('de'));
    render(ui());
    await userEvent.click(mic());
    expect(last().lang).toBe('de-DE');
  });

  it('puts interim and final words after what was typed, and never sends', async () => {
    const user = userEvent.setup();
    render(ui());
    await user.type(box(), 'Draft');
    await user.click(mic());

    last().emit([['a reply', false]]);
    expect(box().value).toBe('Draft a reply');
    last().emit([['a reply to Bob', true]]);
    expect(box().value).toBe('Draft a reply to Bob');
    last().emit([['a reply to Bob', true], [' about Friday', false]]);
    expect(box().value).toBe('Draft a reply to Bob about Friday');

    expect(streamChat).not.toHaveBeenCalled();
  });

  it('keeps an edit made to earlier text while dictating', async () => {
    const user = userEvent.setup();
    render(ui());
    await user.type(box(), 'Draft');
    await user.click(mic());
    last().emit([['a reply', true]]);
    expect(box().value).toBe('Draft a reply');
    fireEvent.change(box(), { target: { value: 'Drafted a reply' } });
    last().emit([['a reply', true], [' to Bob', false]]);
    expect(box().value).toBe('Drafted a reply to Bob');
  });

  it('keeps a correction made to dictated words, and adds only what is said next', async () => {
    render(ui());
    await userEvent.click(mic());
    last().emit([['helo world', true]]);
    expect(box().value).toBe('helo world');
    fireEvent.change(box(), { target: { value: 'hello world' } });
    last().emit([['helo world', true], [' how are you', false]]);
    expect(box().value).toBe('hello world how are you');
    last().emit([['helo world', true], [' how are you', true]]);
    expect(box().value).toBe('hello world how are you');
  });

  it('stops on a second click', async () => {
    render(ui());
    await userEvent.click(mic());
    await userEvent.click(mic());
    expect(last().calls).toEqual(['start', 'stop']);
    expect(mic()).toHaveAttribute('aria-pressed', 'false');
  });

  it('stops on Send, and a late result cannot refill the cleared box', async () => {
    const user = userEvent.setup();
    render(ui());
    await user.click(mic());
    last().emit([['send the report', true]]);
    const rec = last();
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(rec.calls).toContain('abort');
    expect(streamChat).toHaveBeenCalledWith('send the report', expect.anything());
    rec.emit([['send the report', true], [' again', false]]);
    expect(box().value).toBe('');
  });

  it('stops when the page goes away', async () => {
    const view = render(ui());
    await userEvent.click(mic());
    const rec = last();
    view.unmount();
    expect(rec.calls).toContain('abort');
  });

  it('stops when Pincer goes offline', async () => {
    const view = render(ui());
    await userEvent.click(mic());
    health.mockReturnValue(DOWN);
    view.rerender(ui());
    expect(last().calls).toContain('abort');
    expect(mic()).toBeDisabled();
    expect(mic()).toHaveAttribute('aria-pressed', 'false');
  });

  it('explains a blocked microphone and resets the button', async () => {
    render(ui());
    await userEvent.click(mic());
    last().fail('not-allowed');
    expect(screen.getByRole('alert')).toHaveTextContent(/microphone access is blocked/i);
    expect(mic()).toHaveAttribute('aria-pressed', 'false');
  });

  it('explains other recognition errors and resets the button', async () => {
    render(ui());
    await userEvent.click(mic());
    last().fail('network');
    expect(screen.getByRole('alert')).toHaveTextContent(/dictation stopped/i);
    expect(mic()).toHaveAttribute('aria-pressed', 'false');
  });
});
