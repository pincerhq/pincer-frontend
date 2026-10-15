/**
 * How the analyser's frequency data becomes bar levels: the speech band split
 * into equal groups, each averaged to 0..1 — flat (0) when silent.
 */
import { describe, it, expect } from 'vitest';
import { barLevels, VOICE_BINS, captureConflictsWithRecognition } from '@/lib/voiceLevel';

const spectrum = (fill: (i: number) => number) => Uint8Array.from({ length: 128 }, (_, i) => fill(i));

describe('barLevels', () => {
  it('is flat when silent', () => {
    expect(barLevels(spectrum(() => 0), 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it('is full at maximum level', () => {
    expect(barLevels(spectrum(() => 255), 5)).toEqual([1, 1, 1, 1, 1]);
  });

  it('follows the level in each part of the speech band', () => {
    const per = VOICE_BINS / 5;
    const levels = barLevels(spectrum((i) => (i < per ? 255 : i < 2 * per ? 51 : 0)), 5);
    expect(levels[0]).toBe(1);
    expect(levels[1]).toBeCloseTo(0.2);
    expect(levels.slice(2)).toEqual([0, 0, 0]);
  });

  it('ignores bins above the speech band', () => {
    expect(barLevels(spectrum((i) => (i >= VOICE_BINS ? 255 : 0)), 5)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('captureConflictsWithRecognition', () => {
  const env = (ua: string, extra: { gesture?: boolean; touchPoints?: number } = {}) => ({
    userAgent: ua, maxTouchPoints: extra.touchPoints ?? 0, hasGestureEvent: !!extra.gesture,
  });
  it.each([
    ['desktop Chrome', env('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'), false],
    ['macOS Safari (GestureEvent)', env('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', { gesture: true }), true],
    ['iPhone Safari', env('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), true],
    ['iOS Chrome (CriOS, still WebKit)', env('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1'), true],
    ['iPadOS (desktop UA + touch)', env('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', { touchPoints: 5 }), true],
    ['Android Chrome', env('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36', { touchPoints: 5 }), false],
  ])('%s → %s', (_name, e, conflicts) => {
    expect(captureConflictsWithRecognition(e)).toBe(conflicts);
  });
});
