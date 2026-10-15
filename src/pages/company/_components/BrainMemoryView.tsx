/**
 * Memory — operate on remembered keys. Store / inspect / forget are REAL
 * (memento `remember` / `search(key=...)` / `forget`, run by the agent).
 * The key LIST is a local inventory of what this console has touched —
 * memento has no enumerate-keys tool, and the badge says so.
 */
import { useState } from 'react';
import {
  Check,
  Database,
  Eye,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { forgetCompanyBrain, inspectBrainKey, teachCompanyBrain } from '@/lib/api/company';
import { dropKey, loadKeys, upsertKey, type BrainKey } from '@/pages/company/_lib/brainKeys';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export default function BrainMemoryView() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<BrainKey[]>(loadKeys);
  const [selected, setSelected] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState<'store' | 'inspect' | 'forget' | null>(null);
  const [serverState, setServerState] = useState<string | null>(null);

  const pick = (k: BrainKey) => {
    setSelected(k.key);
    setKey(k.key);
    setContent(k.lastContent);
    setServerState(null);
  };

  const startNew = () => {
    setSelected(null);
    setKey('');
    setContent('');
    setServerState(null);
  };

  const store = async () => {
    if (busy || !key.trim() || !content.trim()) return;
    setBusy('store');
    try {
      const reply = await teachCompanyBrain(key.trim(), content.trim());
      setKeys(upsertKey(key.trim(), content.trim()));
      setSelected(key.trim());
      setServerState(reply);
      toast({ title: 'Stored', description: `Key "${key.trim()}" written to the brain.` });
    } catch (err) {
      toast({ title: 'Store failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const inspect = async () => {
    if (busy || !key.trim()) return;
    setBusy('inspect');
    setServerState(null);
    try {
      const reply = await inspectBrainKey(key.trim());
      setServerState(reply === 'NOTHING_STORED' ? 'Nothing is stored under this key on the server.' : reply);
      if (reply !== 'NOTHING_STORED') setKeys(upsertKey(key.trim(), reply));
    } catch (err) {
      toast({ title: 'Inspect failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const forget = async () => {
    if (busy || !key.trim()) return;
    setBusy('forget');
    try {
      await forgetCompanyBrain(key.trim());
      setKeys(dropKey(key.trim()));
      toast({ title: 'Forgotten', description: `Key "${key.trim()}" removed from the brain.` });
      startNew();
    } catch (err) {
      toast({ title: 'Forget failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Key inventory */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--line-soft)]">
        <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
          <p className="plat-eyebrow flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5" />
            Keys ({keys.length})
          </p>
          <button
            type="button"
            onClick={startNew}
            style={{ height: 28, padding: '0 12px', fontSize: 11, gap: 4 }}
            className="plat-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/25"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {keys.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-[var(--text-4)]">
              Nothing taught from this console yet.
            </p>
          ) : (
            keys.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => pick(k)}
                className={cn(
                  'w-full rounded-[10px] px-3 py-2.5 text-left transition-colors',
                  selected === k.key
                    ? 'bg-[color-mix(in_srgb,var(--ink)_7%,transparent)]'
                    : 'hover:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)]',
                )}
              >
                <p
                  className="truncate text-xs font-medium text-[var(--ink)]"
                  style={{ fontFamily: 'var(--mono)' }}
                >
                  {k.key}
                </p>
                <p className="mt-0.5 truncate text-xs text-[var(--text-4)]">{k.lastContent}</p>
              </button>
            ))
          )}
        </div>
        <div className="border-t border-[var(--line-soft)] px-4 py-2.5">
          <p className="text-[10px] leading-relaxed text-[var(--text-4)]">
            This list is what you stored from this browser — memento has no
            list-keys tool, so it cannot be read back from the server.
          </p>
        </div>
      </aside>

      {/* Editor */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-[var(--line-soft)] px-6 pb-5 pt-5">
          <p className="plat-crumb mb-1.5 text-[12px] text-[var(--text-4)]">3days.company</p>
          <h1 className="text-[26px] leading-tight text-[var(--ink)]">Memory</h1>
          <p className="mt-1 text-[13px] text-[var(--text-4)]">
            Knowledge that never becomes a file — decisions, conditions, agreements — stored by key
          </p>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <div className="max-w-2xl space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="mem-key" className="text-xs font-medium text-[var(--text-2)]">Key</Label>
              <Input
                id="mem-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="supplier-mueller-skonto"
                style={{ fontFamily: 'var(--mono)' }}
                className="rounded-[10px] border-[var(--line)] bg-[color:var(--paper)] text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mem-content" className="text-xs font-medium text-[var(--text-2)]">Content</Label>
              <Textarea
                id="mem-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={5}
                placeholder="'Supplier Müller grants 5% Skonto on invoices paid within 10 days, agreed 2026-08-12 by phone.'"
                className="rounded-[10px] border-[var(--line)] bg-[color:var(--paper)] text-sm"
              />
              <p className="text-[11px] text-[var(--text-4)]">
                Storing to an existing key fully replaces its previous content.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={store}
                disabled={!!busy || !key.trim() || !content.trim()}
                className="plat-btn h-9 px-4 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/25"
              >
                {busy === 'store' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Store
              </button>
              <button
                type="button"
                onClick={inspect}
                disabled={!!busy || !key.trim()}
                className="plat-btn-ghost h-9 px-4 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/25"
              >
                {busy === 'inspect' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                Inspect server state
              </button>
              <button
                type="button"
                onClick={forget}
                disabled={!!busy || !key.trim()}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--bad-fg)_25%,transparent)] px-4 text-[12.5px] font-semibold text-[var(--bad-fg)] transition-colors hover:bg-[color-mix(in_srgb,var(--bad-fg)_6%,transparent)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bad-fg)]/25"
              >
                {busy === 'forget' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Forget
              </button>
            </div>

            {serverState && (
              <div className="rounded-[14px] border border-[var(--line-soft)] bg-[color:var(--paper)] p-4">
                <p className="plat-eyebrow mb-2 flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-[var(--ok-fg)]" />
                  Server state
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-1)]">{serverState}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
