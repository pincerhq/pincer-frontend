/**
 * Chart primitives for the detail views. Hand-rolled SVG rather than a chart
 * library so the marks use the platform tokens (hairline grid, mono ticks).
 *
 * One y-axis per chart, one hue per measure, status only in the ok/bad tokens,
 * and a hover layer on every plot instead of a label on every point.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface Point {
  /** Short form shown on the axis, e.g. "08-14". */
  label: string;
  value: number;
  /** Long form used in the tooltip (e.g. "Thu 14 Aug 2026"). */
  full?: string;
  /** Optional second line in the tooltip. */
  sub?: string;
}

/**
 * Container width, so the SVG can be laid out in real pixels. The observer
 * comes from the element's own window: a detail view opened in its own tab is
 * a second document, and the parent's ResizeObserver does not see it.
 */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const view = el.ownerDocument.defaultView ?? window;
    const measure = () => setW(el.clientWidth);
    measure();

    const RO = view.ResizeObserver;
    const ro = RO
      ? new RO((entries) => {
          const cr = entries[0]?.contentRect;
          if (cr) setW(Math.round(cr.width));
        })
      : null;
    ro?.observe(el);
    view.addEventListener('resize', measure);

    return () => {
      ro?.disconnect();
      view.removeEventListener('resize', measure);
    };
  }, []);

  return [ref, w] as const;
}

/** Rect anchored to the baseline with only its top corners rounded. */
function topRoundedRect(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, Math.max(h, 0));
  const bottom = y + h;
  return `M${x},${bottom} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${bottom} Z`;
}

/** Drops ticks that would print the same label twice on a small scale. */
function dedupeTicks(fracs: number[], label: (f: number) => string) {
  const seen = new Set<string>();
  return fracs.filter((f) => {
    const l = label(f);
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  });
}

function ChartEmpty({ label, height }: { label: string; height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-[10px] text-xs"
      style={{ height, background: 'var(--sand)', color: 'var(--text-5)' }}
    >
      {label}
    </div>
  );
}

// ── Time series: area or bars, one measure, one axis ─────────────────

export function TimeSeries({
  data,
  kind = 'area',
  height = 200,
  format = (n) => String(n),
  color = 'var(--brand)',
  emptyLabel = 'No data for this period yet',
  yLabel,
}: {
  data: Point[];
  kind?: 'area' | 'bar';
  height?: number;
  format?: (n: number) => string;
  color?: string;
  emptyLabel?: string;
  yLabel?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const PAD = { t: 14, r: 10, b: 24, l: 52 };
  const plotW = Math.max(0, width - PAD.l - PAD.r);
  const plotH = Math.max(0, height - PAD.t - PAD.b);

  const max = useMemo(
    () => Math.max(...data.map((d) => d.value), 0) || 1,
    [data],
  );

  // One point cannot make a line, so fall back to a single bar.
  const mode = data.length < 2 ? 'bar' : kind;

  const xAt = useCallback(
    (i: number) =>
      data.length < 2 ? PAD.l + plotW / 2 : PAD.l + (i / (data.length - 1)) * plotW,
    [data.length, plotW, PAD.l],
  );
  const yAt = useCallback((v: number) => PAD.t + plotH - (v / max) * plotH, [max, plotH, PAD.t]);

  const linePath = useMemo(() => {
    if (mode !== 'area' || !plotW) return '';
    return data.map((d, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(2)},${yAt(d.value).toFixed(2)}`).join(' ');
  }, [data, mode, plotW, xAt, yAt]);

  const areaPath = useMemo(
    () =>
      linePath
        ? `${linePath} L${xAt(data.length - 1).toFixed(2)},${PAD.t + plotH} L${xAt(0).toFixed(2)},${PAD.t + plotH} Z`
        : '',
    [linePath, data.length, xAt, plotH, PAD.t],
  );

  const onMove = (ev: React.PointerEvent<SVGRectElement>) => {
    const box = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const x = ev.clientX - box.left;
    if (data.length < 2) return setHover(0);
    const i = Math.round(((x - PAD.l) / Math.max(plotW, 1)) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  if (!data.length || data.every((d) => d.value === 0)) {
    return <ChartEmpty label={emptyLabel} height={height} />;
  }

  const active = hover != null ? data[hover] : null;
  // A $0.90 scale still gets its midline; a 1-action scale must not read
  // "1 / 1 / 0".
  const tickFracs = dedupeTicks([0, 0.5, 1], (f) => format(max * f));
  const tipX = hover != null ? xAt(hover) : 0;
  const gridId = `g-${Math.abs(max * 1000).toFixed(0)}-${data.length}-${kind}`;

  // First, middle, last: a label under every tick is noise.
  const tickIdx = data.length <= 3 ? data.map((_, i) => i) : [0, Math.floor((data.length - 1) / 2), data.length - 1];

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={yLabel ?? 'time series'}>
          <defs>
            <linearGradient id={gridId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.20" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Grid and y ticks at 0 / half / max */}
          {tickFracs.map((f) => {
            const y = PAD.t + plotH - f * plotH;
            return (
              <g key={f}>
                <line
                  x1={PAD.l}
                  x2={PAD.l + plotW}
                  y1={y}
                  y2={y}
                  stroke="var(--line-soft)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.l - 8}
                  y={y + 3}
                  textAnchor="end"
                  fontFamily="var(--mono)"
                  fontSize={9.5}
                  fill="var(--text-5)"
                >
                  {format(max * f)}
                </text>
              </g>
            );
          })}

          {mode === 'area' ? (
            <>
              <path d={areaPath} fill={`url(#${gridId})`} />
              <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </>
          ) : (
            data.map((d, i) => {
              const slot = plotW / data.length;
              const w = Math.max(2, Math.min(slot - 2, 36));
              const x = PAD.l + i * slot + (slot - w) / 2;
              const h = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * plotH);
              return (
                <path
                  key={`${d.label}-${i}`}
                  d={topRoundedRect(x, PAD.t + plotH - h, w, h, 4)}
                  fill={color}
                  opacity={hover == null || hover === i ? 1 : 0.45}
                />
              );
            })
          )}

          {/* Hover layer: crosshair + marker */}
          {active && mode === 'area' && (
            <>
              <line x1={tipX} x2={tipX} y1={PAD.t} y2={PAD.t + plotH} stroke="var(--line)" strokeWidth={1} />
              <circle cx={tipX} cy={yAt(active.value)} r={4.5} fill={color} stroke="var(--paper)" strokeWidth={2} />
            </>
          )}

          {tickIdx.map((i) => (
            <text
              key={i}
              x={mode === 'bar' ? PAD.l + (i + 0.5) * (plotW / data.length) : xAt(i)}
              y={height - 7}
              textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
              fontFamily="var(--mono)"
              fontSize={9.5}
              fill="var(--text-5)"
            >
              {data[i].label}
            </text>
          ))}

          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}

      {active && (
        <div
          className="pointer-events-none absolute z-10 rounded-[8px] px-2.5 py-1.5 text-[11px] shadow-sm"
          style={{
            left: Math.max(0, Math.min(width - 150, (mode === 'bar' ? PAD.l + ((hover ?? 0) + 0.5) * (plotW / data.length) : tipX) - 75)),
            top: 0,
            width: 150,
            background: 'var(--ink)',
            color: '#fff',
          }}
        >
          <p className="font-mono text-[10px] opacity-70">{active.full ?? active.label}</p>
          <p className="mt-0.5 font-semibold">{format(active.value)}</p>
          {active.sub && <p className="opacity-70">{active.sub}</p>}
        </div>
      )}
    </div>
  );
}

// ── Stacked status bars (approved vs failed) ─────────────────────────

export function StatusBars({
  data,
  height = 200,
  emptyLabel = 'No actions recorded in this period',
}: {
  data: { label: string; full?: string; ok: number; bad: number }[];
  height?: number;
  emptyLabel?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const PAD = { t: 14, r: 10, b: 24, l: 52 };
  const plotW = Math.max(0, width - PAD.l - PAD.r);
  const plotH = Math.max(0, height - PAD.t - PAD.b);
  const max = Math.max(...data.map((d) => d.ok + d.bad), 0) || 1;

  if (!data.length || data.every((d) => d.ok + d.bad === 0)) {
    return <ChartEmpty label={emptyLabel} height={height} />;
  }

  const tickFracs = dedupeTicks([0, 0.5, 1], (f) => String(Math.round(max * f)));
  const slot = plotW / data.length;
  const bw = Math.max(2, Math.min(slot - 2, 36));
  const active = hover != null ? data[hover] : null;
  const tickIdx = data.length <= 3 ? data.map((_, i) => i) : [0, Math.floor((data.length - 1) / 2), data.length - 1];

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="actions per day, approved and failed">
          {tickFracs.map((f) => {
            const y = PAD.t + plotH - f * plotH;
            return (
              <g key={f}>
                <line x1={PAD.l} x2={PAD.l + plotW} y1={y} y2={y} stroke="var(--line-soft)" />
                <text x={PAD.l - 8} y={y + 3} textAnchor="end" fontFamily="var(--mono)" fontSize={9.5} fill="var(--text-5)">
                  {Math.round(max * f)}
                </text>
              </g>
            );
          })}

          {data.map((d, i) => {
            const x = PAD.l + i * slot + (slot - bw) / 2;
            const total = d.ok + d.bad;
            const hTotal = (total / max) * plotH;
            const hBad = (d.bad / max) * plotH;
            const hOk = Math.max(0, hTotal - hBad);
            const dim = hover == null || hover === i ? 1 : 0.45;
            return (
              <g key={`${d.label}-${i}`} opacity={dim}>
                {d.bad > 0 && (
                  <path
                    d={topRoundedRect(x, PAD.t + plotH - hTotal, bw, Math.max(2, hBad), 4)}
                    fill="var(--bad-fg)"
                  />
                )}
                {d.ok > 0 && (
                  <path
                    d={topRoundedRect(
                      x,
                      PAD.t + plotH - hOk,
                      bw,
                      Math.max(2, hOk - (d.bad > 0 ? 2 : 0)),
                      d.bad > 0 ? 0 : 4,
                    )}
                    fill="var(--ink)"
                  />
                )}
              </g>
            );
          })}

          {tickIdx.map((i) => (
            <text
              key={i}
              x={PAD.l + (i + 0.5) * slot}
              y={height - 7}
              textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
              fontFamily="var(--mono)"
              fontSize={9.5}
              fill="var(--text-5)"
            >
              {data[i].label}
            </text>
          ))}

          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            fill="transparent"
            onPointerMove={(ev) => {
              const box = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
              const i = Math.floor((ev.clientX - box.left - PAD.l) / Math.max(slot, 1));
              setHover(Math.max(0, Math.min(data.length - 1, i)));
            }}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}

      {active && (
        <div
          className="pointer-events-none absolute z-10 rounded-[8px] px-2.5 py-1.5 text-[11px] shadow-sm"
          style={{
            left: Math.max(0, Math.min(width - 150, PAD.l + ((hover ?? 0) + 0.5) * slot - 75)),
            top: 0,
            width: 150,
            background: 'var(--ink)',
            color: '#fff',
          }}
        >
          <p className="font-mono text-[10px] opacity-70">{active.full ?? active.label}</p>
          <p className="mt-0.5 font-semibold">{active.ok + active.bad} actions</p>
          <p className="opacity-70">{active.bad} failed</p>
        </div>
      )}
    </div>
  );
}

/** Identity is never carried by colour alone. */
export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
          <span className="h-2 w-2 rounded-full" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ── Ranked horizontal bars: magnitude, one hue, direct labels ───────

export function RankBars({
  rows,
  format = (n) => String(n),
  color = 'var(--ink)',
  emptyLabel = 'Nothing recorded yet',
  max: maxOverride,
}: {
  rows: { label: string; value: number; sub?: string }[];
  format?: (n: number) => string;
  color?: string;
  emptyLabel?: string;
  max?: number;
}) {
  if (!rows.length) return <ChartEmpty label={emptyLabel} height={180} />;
  const max = maxOverride ?? (Math.max(...rows.map((r) => r.value), 0) || 1);

  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate font-mono text-[11.5px]" style={{ color: 'var(--text-2)' }} title={r.label}>
              {r.label}
            </span>
            {r.sub && (
              <span className="shrink-0 text-[10.5px]" style={{ color: 'var(--text-5)' }}>
                {r.sub}
              </span>
            )}
          </div>
          <span className="font-mono text-[11.5px] tabular-nums" style={{ color: 'var(--text-1)' }}>
            {format(r.value)}
          </span>
          <div
            className="col-span-2 mt-1 h-1.5 overflow-hidden rounded-full"
            style={{ background: 'var(--sand-deep)' }}
          >
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Caption above the plot, so every chart says what it is. */
export function Figure({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`plat-panel ${className ?? ''}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-semibold">{title}</p>
        {hint && (
          <span className="text-[11px]" style={{ color: 'var(--text-5)' }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
