/**
 * Microphone level for the dictation button's live bars.
 *
 * Read locally from a Web Audio AnalyserNode on a `getUserMedia` stream —
 * nothing leaves the browser. At `fftSize` 256 each bin is ~187 Hz at 48 kHz,
 * so the first 20 bins cover speech (up to ~3.7 kHz); bins above it would only
 * make the bars twitch on hiss.
 */
export const VOICE_BINS = 20;
export const ANALYSER_FFT_SIZE = 256;

/** The speech band split into `bars` equal groups, each averaged to 0..1. */
export function barLevels(freq: Uint8Array, bars: number): number[] {
  const per = VOICE_BINS / bars;
  return Array.from({ length: bars }, (_, b) => {
    const from = Math.floor(b * per);
    const to = Math.floor((b + 1) * per);
    let sum = 0;
    for (let i = from; i < to; i++) sum += freq[i] ?? 0;
    return sum / ((to - from) * 255);
  });
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface CaptureEnv {
  userAgent: string;
  maxTouchPoints: number;
  hasGestureEvent: boolean;
}

const currentEnv = (): CaptureEnv => ({
  userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
  maxTouchPoints: typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints ?? 0,
  hasGestureEvent: typeof window !== 'undefined' && 'GestureEvent' in window,
});

/**
 * Whether opening a second microphone capture would end a running speech
 * recognition. WebKit does that (Safari on macOS, and every iOS browser — they
 * all run WebKit): `onend`/`audio-capture` fires as soon as the analyser starts.
 * Detected by engine first (`GestureEvent` exists only in WebKit), then by the
 * iOS user agents, then iPadOS, which reports a desktop Mac but has touch.
 */
export function captureConflictsWithRecognition(env: CaptureEnv = currentEnv()): boolean {
  if (env.hasGestureEvent) return true;
  if (/iP(hone|ad|od)/.test(env.userAgent)) return true;
  return /Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1;
}
