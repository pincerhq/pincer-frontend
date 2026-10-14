/**
 * How the analyser's frequency data becomes bar levels: the speech band split
 * into equal groups, each averaged to 0..1 — flat (0) when silent.
 */
import { describe, it, expect } from 'vitest';
import { barLevels, VOICE_BINS } from '@/lib/voiceLevel';

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
