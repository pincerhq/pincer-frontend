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
