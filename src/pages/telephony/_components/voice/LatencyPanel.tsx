/**
 * Turn latency for one call (Sprint 5 T5.1 `TURN_LATENCY` events).
 *
 * The point of this panel is that a latency regression is visible per call,
 * without going to Grafana: each turn is one stacked bar (STT → LLM TTFT →
 * TTS) drawn on a shared scale with the two Sprint 5 target lines behind it,
 * so a turn that blew the budget and *which stage* did it are the same glance.
 *
 * When the list endpoint gave us only the p50 roll-up, the panel says so and
 * draws the single p50 bar rather than faking per-turn detail.
 */
import { Gauge } from 'lucide-react';
import {
  LATENCY_TARGET_GOOD_MS,
  LATENCY_TARGET_OK_MS,
  type CallLatency,
  type LatencyTurn,
} from '@/lib/api/voice';
import { CHIP_TONE_CLASS, fmtMs, latencyTone } from '@/pages/telephony/_lib/voiceMeta';
import { cn } from '@/lib/utils';

const STAGES = [
  { key: 'stt_ms', label: 'STT', bar: 'bg-[var(--brand)]/70' },
  { key: 'llm_ttft_ms', label: 'LLM TTFT', bar: 'bg-[var(--ink)]/70' },
  { key: 'tts_ms', label: 'TTS', bar: 'bg-amber-400' },
] as const;

type StageKey = (typeof STAGES)[number]['key'];

/** Sum of the timed stages — used when the backend sends no `total_ms`. */
function turnTotal(t: LatencyTurn): number {
  if (t.total_ms != null) return t.total_ms;
  return STAGES.reduce((n, s) => n + (t[s.key] ?? 0), 0);
}

function TurnBar({ turn, scale }: { turn: LatencyTurn; scale: number }) {
  const total = turnTotal(turn);
  const pct = (ms: number) => `${Math.max(0, (ms / scale) * 100)}%`;
  return (
    <div className="flex items-center gap-2">
      <span className="w-5 shrink-0 text-right font-mono text-[10px] text-[var(--text-5)]">
        {turn.turn}
      </span>
      <div className="relative h-3 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-[var(--sand)]">
        <div className="flex h-full">
          {STAGES.map((s) => {
            const ms = turn[s.key as StageKey];
            if (ms == null || ms <= 0) return null;
            return (
              <div
                key={s.key}
                className={s.bar}
                style={{ width: pct(ms) }}
                title={`Turn ${turn.turn} · ${s.label} ${fmtMs(ms)}`}
              />
            );
          })}
        </div>
      </div>
      <span
        className={cn(
          'w-14 shrink-0 text-right font-mono text-[10px] tabular-nums',
          total <= LATENCY_TARGET_GOOD_MS
            ? 'text-green-700'
            : total <= LATENCY_TARGET_OK_MS
              ? 'text-amber-700'
              : 'text-red-600',
        )}
      >
        {fmtMs(total)}
      </span>
    </div>
  );
}

export default function LatencyPanel({ latency }: { latency: CallLatency }) {
  const perTurn = latency.per_turn ?? [];
  const stages = latency.stages_p50;

  // One scale for every bar, so bars are comparable to each other and to the
  // target lines. Never smaller than the ≤2.0s target — otherwise a fast call
  // would draw its target line off the right edge.
  const maxTotal = perTurn.length
    ? Math.max(...perTurn.map(turnTotal))
    : (stages.total ?? latency.p50_ms ?? 0);
  const scale = Math.max(maxTotal * 1.05, LATENCY_TARGET_OK_MS * 1.05);
  const linePct = (ms: number) => `${(ms / scale) * 100}%`;

  const fallbackTurn: LatencyTurn = {
    turn: 1,
    stt_ms: stages.stt,
    llm_ttft_ms: stages.llm_ttft,
    tts_ms: stages.tts,
    total_ms: stages.total ?? latency.p50_ms,
  };

  return (
    <section className="rounded-[10px] border border-[var(--line)] bg-[var(--paper)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="plat-eyebrow flex items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5 text-[var(--text-5)]" />
          Turn latency
        </p>
        {latency.p50_ms != null && (
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-medium tabular-nums',
              CHIP_TONE_CLASS[latencyTone(latency.p50_ms)],
            )}
          >
            p50 {fmtMs(latency.p50_ms)}
          </span>
        )}
      </div>

      <div className="mb-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-4)]">
        <span>
          {latency.turns} turn{latency.turns === 1 ? '' : 's'}
        </span>
        {latency.p95_ms != null && (
          <span className="tabular-nums">p95 {fmtMs(latency.p95_ms)}</span>
        )}
        {STAGES.map((s) => {
          const key = s.key.replace(/_ms$/, '') as 'stt' | 'llm_ttft' | 'tts';
          const ms = stages[key];
          if (ms == null) return null;
          return (
            <span key={s.key} className="flex items-center gap-1 tabular-nums">
              <span className={cn('h-2 w-2 rounded-[2px]', s.bar)} />
              {s.label} {fmtMs(ms)}
            </span>
          );
        })}
      </div>

      {/* Bars + target lines on one shared scale */}
      <div className="relative">
        {/* The two Sprint 5 targets, drawn behind the bars. */}
        <div className="pointer-events-none absolute inset-y-0 left-7 right-16">
          <div
            className="absolute inset-y-0 w-px bg-green-500/50"
            style={{ left: linePct(LATENCY_TARGET_GOOD_MS) }}
            title={`Target ${LATENCY_TARGET_GOOD_MS / 1000}s`}
          />
          <div
            className="absolute inset-y-0 w-px bg-amber-500/50"
            style={{ left: linePct(LATENCY_TARGET_OK_MS) }}
            title={`Ceiling ${LATENCY_TARGET_OK_MS / 1000}s`}
          />
        </div>
        <div className="relative max-h-52 space-y-1 overflow-y-auto">
          {(perTurn.length ? perTurn : [fallbackTurn]).map((t) => (
            <TurnBar key={t.turn} turn={t} scale={scale} />
          ))}
        </div>
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-5)]">
        {perTurn.length
          ? `Lines mark the ${LATENCY_TARGET_GOOD_MS / 1000}s target and the ${LATENCY_TARGET_OK_MS / 1000}s ceiling.`
          : 'Per-turn timings are not on this response — the bar shows the p50 stage breakdown.'}
      </p>
    </section>
  );
}
