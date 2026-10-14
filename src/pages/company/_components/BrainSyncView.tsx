/**
 * Sync — ingestion health. "Run health check" is REAL: the agent executes
 * memento's `sync_status` tool and the raw report is shown verbatim. The
 * reference panel beside it is static documentation of how sync behaves.
 */
import { useState } from 'react';
import { Loader2, RefreshCw, TerminalSquare } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { checkBrainSync } from '@/lib/api/company';
import { useToast } from '@/hooks/use-toast';

export default function BrainSyncView() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setReport(await checkBrainSync());
      setCheckedAt(new Date().toLocaleTimeString());
    } catch (err) {
      toast({
        title: 'Health check failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-soft)] px-6 pb-5 pt-5">
        <div>
          <p className="plat-crumb mb-1.5 text-[12px] text-[var(--text-4)]">3days.company</p>
          <h1 className="text-[26px] leading-tight text-[var(--ink)]">Sync</h1>
          <p className="mt-1 text-[13px] text-[var(--text-4)]">
            The background loop that keeps the index in step with the documents folder
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="plat-btn h-9 px-4 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/25"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {busy ? 'Checking…' : 'Run health check'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <Card className="rounded-[14px] border-[var(--line-soft)] bg-[color:var(--paper)] p-5 shadow-none lg:col-span-2">
            <p className="plat-eyebrow mb-2.5 flex items-center gap-1.5">
              <TerminalSquare className="h-3.5 w-3.5" />
              sync_status {checkedAt && <span className="normal-case text-[var(--text-5)]">· checked {checkedAt}</span>}
            </p>
            {report ? (
              <pre
                className="whitespace-pre-wrap rounded-[12px] bg-[var(--sand)] p-3 text-xs leading-relaxed text-[var(--text-1)]"
                style={{ fontFamily: 'var(--mono)' }}
              >
                {report}
              </pre>
            ) : (
              <p className="py-6 text-center text-xs text-[var(--text-4)]">
                Run the health check — the agent executes memento's sync_status tool and reports here.
              </p>
            )}
          </Card>

          <Card className="rounded-[14px] border-[var(--line-soft)] bg-[color:var(--paper)] p-5 shadow-none">
            <p className="plat-eyebrow mb-3">How sync works</p>
            <div className="space-y-2 text-xs leading-relaxed text-[var(--text-2)]">
              <p>· Initial full scan on startup, then a diff of the documents folder every <span style={{ fontFamily: 'var(--mono)' }}>30s</span>.</p>
              <p>· New / changed / deleted files are picked up automatically — no manual step, no restart.</p>
              <p>· Knowledge taught under Memory is searchable immediately, no sync tick required.</p>
              <p>· Per-file errors are reported for the most recent tick only.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
