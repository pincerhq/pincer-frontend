/**
 * Query console — REAL. Runs memento `search` (via the agent, which passes
 * the tool output through as data) and renders ranked chunks: source file,
 * relevance, snippet. An operator surface: rows, scores, filters — no chat.
 */
import { useMemo, useState } from 'react';
import { Check, Copy, Loader2, Search } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { searchBrainChunks, type BrainChunk } from '@/lib/api/company';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

/** distance → a 0..100 relevance bar (lower distance = more relevant). */
function relevancePct(d: number | null): number | null {
  if (d == null || Number.isNaN(d)) return null;
  return Math.max(4, Math.min(100, Math.round((1 - Math.min(d, 2) / 2) * 100)));
}

export default function BrainSearchView() {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [ranQuery, setRanQuery] = useState<string | null>(null);
  const [rows, setRows] = useState<BrainChunk[]>([]);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const sources = useMemo(
    () => ['all', ...Array.from(new Set(rows.map((r) => r.source))).sort()],
    [rows],
  );
  const visible = sourceFilter === 'all' ? rows : rows.filter((r) => r.source === sourceFilter);

  const run = async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    const t0 = performance.now();
    try {
      const result = await searchBrainChunks(q);
      setRows(result);
      setRanQuery(q);
      setSourceFilter('all');
      setExpanded(null);
      setElapsed(Math.round(performance.now() - t0));
    } catch (err) {
      toast({
        title: 'Query failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-[var(--line-soft)] px-6 pb-5 pt-5">
        <p className="plat-crumb mb-1.5 text-[12px] text-[var(--text-4)]">3days.company</p>
        <h1 className="text-[26px] leading-tight text-[var(--ink)]">Search</h1>
        <p className="mt-1 text-[13px] text-[var(--text-4)]">
          Vector search over the indexed knowledge base — ranked chunks with source and relevance
        </p>
      </div>

      {/* Query bar */}
      <div className="border-b border-[var(--line-soft)] px-6 py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-4)]" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Query…"
              className="rounded-[10px] border-[var(--line)] bg-[color:var(--paper)] pl-10 text-[var(--text-1)] placeholder:text-[var(--text-5)] focus-visible:ring-2 focus-visible:ring-[var(--ink)]/25 focus-visible:ring-offset-0"
            />
          </div>
          <button
            type="submit"
            disabled={busy || !query.trim()}
            className="plat-btn disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/25"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Run
          </button>
        </form>

        {/* Result meta + source filter */}
        {ranQuery && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-4)]">
            <span>
              {rows.length} chunks for{' '}
              <span className="text-[var(--text-2)]" style={{ fontFamily: 'var(--mono)' }}>"{ranQuery}"</span>
              {elapsed != null && <> · {(elapsed / 1000).toFixed(1)}s</>}
            </span>
            {sources.length > 2 && (
              <div className="flex flex-wrap items-center gap-1">
                {sources.map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setSourceFilter(src)}
                    style={{ fontFamily: 'var(--mono)' }}
                    className={cn(
                      'max-w-[220px] truncate rounded-full px-2.5 py-1 text-[10px] transition-colors',
                      sourceFilter === src
                        ? 'bg-[var(--ink)] text-[color:var(--on-ink)]'
                        : 'border border-[var(--line)] text-[var(--text-3)] hover:border-[var(--ink)] hover:text-[var(--ink)]',
                    )}
                  >
                    {src === 'all' ? `all (${rows.length})` : src}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Result rows */}
      <div className="flex-1 overflow-y-auto p-6">
        {!ranQuery ? (
          <p className="mt-12 text-center text-xs text-[var(--text-4)]">
            Run a query to retrieve chunks from the index.
          </p>
        ) : visible.length === 0 ? (
          <p className="mt-12 text-center text-xs text-[var(--text-4)]">
            No chunks matched{sourceFilter !== 'all' ? ' this source' : ''}.
          </p>
        ) : (
          <Card className="overflow-hidden rounded-[14px] border-[var(--line-soft)] bg-[color:var(--paper)] shadow-none">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line-soft)] bg-[var(--sand)] text-left">
                  <th className="plat-eyebrow px-4 py-3">#</th>
                  <th className="plat-eyebrow px-4 py-3">Chunk</th>
                  <th className="plat-eyebrow hidden px-4 py-3 md:table-cell">Source</th>
                  <th className="plat-eyebrow hidden w-36 px-4 py-3 lg:table-cell">Relevance</th>
                  <th className="w-10 px-2 py-3" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => {
                  const pct = relevancePct(r.distance);
                  const isOpen = expanded === i;
                  return (
                    <tr
                      key={i}
                      onClick={() => setExpanded(isOpen ? null : i)}
                      className="cursor-pointer border-b border-[var(--line-soft)] align-top transition-colors last:border-b-0 hover:bg-[color-mix(in_srgb,var(--ink)_2%,transparent)]"
                    >
                      <td className="px-4 py-3 text-xs text-[var(--text-4)]" style={{ fontFamily: 'var(--mono)' }}>{i + 1}</td>
                      <td className="w-full max-w-0 px-4 py-3">
                        <p className={cn('text-sm leading-relaxed text-[var(--text-1)]', !isOpen && 'line-clamp-2')}>
                          {r.text}
                        </p>
                        <p className="mt-1 text-[10px] text-[var(--text-4)] md:hidden" style={{ fontFamily: 'var(--mono)' }}>{r.source}</p>
                      </td>
                      <td
                        className="hidden whitespace-nowrap px-4 py-3 text-xs text-[var(--text-3)] md:table-cell"
                        style={{ fontFamily: 'var(--mono)' }}
                      >
                        {r.source}
                      </td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        {pct == null ? (
                          <span className="text-xs text-[var(--text-5)]">—</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[color:var(--sand)]">
                              <div className="h-full rounded-full bg-[#5aacee]" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="font-mono text-[10px] text-[color:var(--text-3)]">
                              {r.distance!.toFixed(3)}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-3">
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await navigator.clipboard.writeText(r.text);
                            setCopiedIdx(i);
                            setTimeout(() => setCopiedIdx(null), 1200);
                          }}
                          className="rounded-[10px] p-1.5 text-[var(--text-5)] transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] hover:text-[var(--ink)]"
                          aria-label="Copy chunk"
                        >
                          {copiedIdx === i ? <Check className="h-3.5 w-3.5 text-[var(--ok-fg)]" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
