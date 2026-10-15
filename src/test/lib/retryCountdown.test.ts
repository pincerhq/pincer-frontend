/**
 * The offline notice counts down to the next real /api/health poll. react-query
 * restarts its refetch interval on every query update, so the next poll is the
 * last attempt (errorUpdatedAt / dataUpdatedAt) plus the poll interval — the
 * countdown is derived from that, never from a free-running timer.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { retryCountdown, useRetryCountdown } from '@/lib/pincerReachability';

const T0 = new Date('2026-10-14T12:00:00Z').getTime();

describe('retryCountdown', () => {
  it.each([
    [0, 30],
    [1, 30],
    [1_000, 29],
    [15_000, 15],
    [29_000, 1],
    [29_999, 1],
    [30_000, 0],
    [45_000, 0],
    [-5_000, 30], // clock skew never shows more than the poll interval
  ])('%i ms after the last attempt → %i s', (elapsed, seconds) => {
    expect(retryCountdown(T0, T0 + elapsed)).toBe(seconds);
  });
});

describe('useRetryCountdown', () => {
  afterEach(() => vi.useRealTimers());

  it('ticks down once a second from the last attempt and says retrying at 0', () => {
    vi.useFakeTimers({ now: T0 });
    const { result } = renderHook(() => useRetryCountdown(true, T0, false));
    expect(result.current).toBe(30);
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(29);
    act(() => vi.advanceTimersByTime(14_000));
    expect(result.current).toBe(15);
    act(() => vi.advanceTimersByTime(14_000));
    expect(result.current).toBe(1);
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toBe('retrying');
  });

  it('says retrying while the request is in flight', () => {
    vi.useFakeTimers({ now: T0 + 30_000 });
    const { result } = renderHook(() => useRetryCountdown(true, T0, true));
    expect(result.current).toBe('retrying');
  });

  it('restarts from 30 when a retry fails', () => {
    vi.useFakeTimers({ now: T0 });
    const { result, rerender } = renderHook(({ last }) => useRetryCountdown(true, last, false), {
      initialProps: { last: T0 },
    });
    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current).toBe('retrying');
    // The retry goes out and fails 50 ms later; errorUpdatedAt is that moment.
    act(() => vi.advanceTimersByTime(50));
    rerender({ last: Date.now() });
    expect(result.current).toBe(30);
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(29);
  });

  it('is off when not offline, and leaves no timer behind on unmount', () => {
    vi.useFakeTimers({ now: T0 });
    const off = renderHook(() => useRetryCountdown(false, T0, false));
    expect(off.result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    const on = renderHook(() => useRetryCountdown(true, T0, false));
    expect(vi.getTimerCount()).toBe(1);
    on.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
