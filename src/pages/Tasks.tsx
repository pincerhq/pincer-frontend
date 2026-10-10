/**
 * Tasks on REAL backend data from the connected Pincer server.
 *
 *   Scheduled  → /api/schedules?include_past=true   (the cron scheduler)
 *   Journal    → /api/audit                          (every action the agent took)
 *
 * There is no Approvals tab: web approvals are resolved live over SSE inside a
 * Chat turn (asyncio futures) and no endpoint lists pending ones, so the queue
 * that used to sit here was demo rows. Approval cards appear in Chat while the
 * agent is actually waiting.
 *
 * Table chrome, filter pills and tab styling are kept from the old mocked page
 * so the platform still reads as one system.
 */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/dashboard/AppSidebar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Clock, Bot, Activity, BookMarked, Search, Filter, ArrowUpDown,
  ChevronDown, ChevronLeft, ChevronRight, CalendarClock, MessageSquare, Plug,
  Download, Copy, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { queryClient } from '@/lib/queryClient';
import { isConnected } from '@/lib/pincerClient';
import {
  useRecentAudit,
  useSchedules,
  type AuditEntry,
  type ScheduledTask,
} from '@/lib/api/dashboard';

type TabKey = 'scheduled' | 'journal';

// ── Shared bits ──────────────────────────────────────────────────────

const fmtUsd = (v: number | null | undefined) => {
  if (v == null) return '—';
  if (v > 0 && v < 0.01) return '<$0.01';
  return `$${v.toFixed(2)}`;
};

const fmtDurationMs = (ms: number | null | undefined) =>
  ms == null ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

const fmtWhen = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
};

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return iso;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

const searchInputCls =
  'pl-11 h-9 !rounded-[10px] border-[color:var(--line)] bg-[color:var(--paper)] text-[13px] placeholder:text-[color:var(--text-5)] focus-visible:border-[color:var(--ink)] focus-visible:ring-0 focus-visible:ring-offset-0';
/** Inactive filter pill: hairline outline, quiet text (rule: no saturated chrome). */
const filterBtnCls =
  '!rounded-full !border !border-[color:var(--line)] !bg-transparent !text-[color:var(--text-2)] min-w-[130px] justify-between text-xs font-medium hover:!bg-[rgba(20,22,26,0.04)] hover:!text-[color:var(--ink)]';
/** Active filter pill: ink fill, white text. */
const filterBtnActiveCls =
  '!rounded-full !border !border-transparent !bg-[color:var(--ink)] !text-white min-w-[130px] justify-between text-xs font-medium hover:!bg-[color:var(--ink)] hover:!opacity-90';
const thCls =
  'text-left px-4 py-3 font-medium text-[color:var(--text-3)] cursor-pointer select-none hover:text-[color:var(--ink)]';

function SortHeader({
  label, field, sortField, sortAsc, onSort, className,
}: {
  label: string;
  field: string;
  sortField: string;
  sortAsc: boolean;
  onSort: (f: string) => void;
  className?: string;
}) {
  return (
    <th className={cn(thCls, className)} onClick={() => onSort(field)}>
      {label}
      <ArrowUpDown
        className={cn(
          'ml-1 inline h-3 w-3',
          sortField === field
            ? (sortAsc ? 'rotate-180 text-[color:var(--ink)]' : 'text-[color:var(--ink)]')
            : 'text-[color:var(--text-5)] opacity-50',
        )}
      />
    </th>
  );
}

/** Numbered pagination + page-size picker, shared by both tables. */
function TableFooter({
  page, totalPages, onPage, pageSize, onPageSize, totalRows,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  pageSize: number;
  onPageSize: (n: number) => void;
  totalRows: number;
}) {
  // Window of at most 5 page numbers around the current one.
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const nums = Array.from({ length: Math.min(5, totalPages) }, (_, i) => start + i);
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5"
      style={{ borderColor: 'var(--line-soft)' }}
    >
      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-4)' }}>
        <span>{totalRows} rows</span>
        <span>·</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium transition-colors hover:bg-[rgba(20,22,26,0.04)]"
              style={{ borderColor: 'var(--line)', color: 'var(--text-2)' }}
            >
              {pageSize} / page
              <ChevronDown className="h-3 w-3" style={{ color: 'var(--text-5)' }} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {[10, 25, 50].map(n => (
              <DropdownMenuItem key={n} onClick={() => onPageSize(n)} className={cn(pageSize === n && 'font-medium')}>
                {n} / page
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-7 w-7 !rounded-full !border-transparent !bg-transparent text-[color:var(--text-4)] hover:!bg-[rgba(20,22,26,0.05)] hover:!text-[color:var(--ink)]" disabled={page === 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          {nums.map(n => (
            <Button
              key={n}
              variant="outline"
              size="icon"
              className={cn(
                'h-7 w-7 text-xs !rounded-full',
                n === page
                  ? '!bg-[color:var(--ink)] !text-white !border-transparent hover:!opacity-90'
                  : '!border-transparent !bg-transparent text-[color:var(--text-3)] hover:!bg-[rgba(20,22,26,0.05)] hover:!text-[color:var(--ink)]',
              )}
              onClick={() => onPage(n)}
            >
              {n}
            </Button>
          ))}
          <Button variant="outline" size="icon" className="h-7 w-7 !rounded-full !border-transparent !bg-transparent text-[color:var(--text-4)] hover:!bg-[rgba(20,22,26,0.05)] hover:!text-[color:var(--ink)]" disabled={page === totalPages} onClick={() => onPage(page + 1)}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

function FilterPill({
  value, options, onSelect, allLabel,
}: {
  value: string;
  options: string[];
  onSelect: (v: string) => void;
  allLabel: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={value === 'All' ? filterBtnCls : filterBtnActiveCls}
        >
          <span className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 opacity-60" />
            {value === 'All' ? allLabel : value}
          </span>
          <ChevronDown className="ml-2 h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {options.map(o => (
          <DropdownMenuItem key={o} onClick={() => onSelect(o)} className={cn(value === o && 'font-medium')}>
            {o === 'All' ? `All ${allLabel.toLowerCase()}s` : o}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One labelled row inside a detail modal. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <span className="shrink-0 text-xs" style={{ color: 'var(--text-4)' }}>{label}</span>
      <span className="min-w-0 text-right text-sm" style={{ color: 'var(--ink)' }}>{children}</span>
    </div>
  );
}

/** Pretty-printed payload with a copy button — for metadata / action JSON. */
function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(value, null, 2);
  return (
    <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--line-soft)' }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="plat-eyebrow">{label}</span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-[rgba(20,22,26,0.04)]"
          style={{ borderColor: 'var(--line)', color: 'var(--text-2)' }}
        >
          {copied ? <Check className="h-3 w-3" style={{ color: 'var(--ok-fg)' }} /> : <Copy className="h-3 w-3" />}
          Copy JSON
        </button>
      </div>
      <pre
        className="max-h-56 overflow-auto rounded-[10px] p-3 font-mono text-xs leading-relaxed"
        style={{ background: 'var(--sand)', color: 'var(--text-1)' }}
      >
        {text}
      </pre>
    </div>
  );
}

/** Full detail for one journal (audit) entry. */
function JournalDetailModal({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const hasMeta = entry.metadata && Object.keys(entry.metadata).length > 0;
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-xl gap-0 rounded-[14px] p-0" style={{ borderColor: 'var(--line-soft)' }}>
        <div className="border-b px-6 py-4" style={{ borderColor: 'var(--line-soft)' }}>
          <DialogTitle className="flex flex-wrap items-center gap-2.5 text-base font-semibold" style={{ color: 'var(--ink)' }}>
            <div
              className="flex h-8 w-8 items-center justify-center rounded-[10px]"
              style={{ background: 'var(--sand)' }}
            >
              <Bot className="h-4 w-4" style={{ color: entry.approved ? 'var(--ink)' : 'var(--bad-fg)' }} />
            </div>
            {entry.tool ?? entry.action}
            <span
              className={cn('plat-pill', entry.approved && 'plat-pill-ok')}
              style={
                entry.approved
                  ? undefined
                  : { background: 'rgba(179,56,46,0.1)', color: 'var(--bad-fg)' }
              }
            >
              {entry.approved ? 'Succeeded' : 'Failed'}
            </span>
          </DialogTitle>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          {entry.input_summary && (
            <div className="mb-3 rounded-[10px] px-4 py-3" style={{ background: 'var(--sand)' }}>
              <p className="plat-eyebrow mb-1">Input</p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>{entry.input_summary}</p>
            </div>
          )}
          {entry.output_summary && (
            <div className="mb-3 rounded-[10px] px-4 py-3" style={{ background: 'var(--sand)' }}>
              <p className="plat-eyebrow mb-1">Output</p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>{entry.output_summary}</p>
            </div>
          )}
          <div className="divide-y divide-[color:var(--line-soft)]">
            <DetailRow label="Action type">{entry.action}</DetailRow>
            {entry.tool && <DetailRow label="Tool"><span className="font-mono text-xs">{entry.tool}</span></DetailRow>}
            <DetailRow label="When">{fmtWhen(entry.timestamp)} <span style={{ color: 'var(--text-4)' }}>({timeAgo(entry.timestamp)})</span></DetailRow>
            <DetailRow label="Cost">{fmtUsd(entry.cost_usd)}</DetailRow>
            <DetailRow label="Duration">{fmtDurationMs(entry.duration_ms)}</DetailRow>
            <DetailRow label="User"><span className="font-mono text-xs">{entry.user_id || '—'}</span></DetailRow>
            <DetailRow label="Entry id"><span className="font-mono text-xs">{entry.id}</span></DetailRow>
          </div>
          {hasMeta && <JsonBlock label="Metadata" value={entry.metadata} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Full detail for one scheduled task. */
function ScheduleDetailModal({ task, onClose }: { task: ScheduledTask; onClose: () => void }) {
  const hasAction = task.action && Object.keys(task.action).length > 0;
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-xl gap-0 rounded-[14px] p-0" style={{ borderColor: 'var(--line-soft)' }}>
        <div className="border-b px-6 py-4" style={{ borderColor: 'var(--line-soft)' }}>
          <DialogTitle className="flex flex-wrap items-center gap-2.5 text-base font-semibold" style={{ color: 'var(--ink)' }}>
            <div
              className="flex h-8 w-8 items-center justify-center rounded-[10px]"
              style={{ background: 'var(--sand)' }}
            >
              <CalendarClock className="h-4 w-4" style={{ color: 'var(--ink)' }} />
            </div>
            {task.name}
            <span className={cn('plat-pill', task.enabled ? 'plat-pill-ok' : 'plat-pill-mute')}>
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: task.enabled ? 'var(--ok-fg)' : 'var(--text-5)' }}
              />
              {task.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </DialogTitle>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          <div className="divide-y divide-[color:var(--line-soft)]">
            <DetailRow label="Kind">{task.kind === 'recurring' ? 'Recurring' : 'One-time'}</DetailRow>
            <DetailRow label="Schedule"><span className="font-mono text-xs">{task.cron_expr}</span></DetailRow>
            <DetailRow label="Timezone">{task.timezone}</DetailRow>
            <DetailRow label="Delivers via">{task.channel}</DetailRow>
            <DetailRow label="Next run">{fmtWhen(task.next_run_at)}</DetailRow>
            <DetailRow label="Last run">{fmtWhen(task.last_run_at)}</DetailRow>
            {task.created_at && <DetailRow label="Created">{fmtWhen(task.created_at)}</DetailRow>}
            {task.updated_at && <DetailRow label="Updated">{fmtWhen(task.updated_at)}</DetailRow>}
            <DetailRow label="Task id"><span className="font-mono text-xs">{String(task.id)}</span></DetailRow>
          </div>
          {hasAction && <JsonBlock label="Action payload — what runs when it fires" value={task.action} />}
          <p
            className="mt-4 rounded-[10px] px-4 py-3 text-xs leading-relaxed"
            style={{ background: 'var(--sand)', color: 'var(--text-3)' }}
          >
            Schedules are managed conversationally — ask in Chat to change or cancel this task
            ("move my morning briefing to 8am", "delete the invoice reminder").
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConnectStrip() {
  return (
    <div className="plat-panel mb-6 flex flex-wrap items-center gap-3 !py-3.5">
      <Plug className="h-4 w-4 shrink-0" style={{ color: 'var(--text-5)' }} />
      <p className="flex-1 text-xs" style={{ color: 'var(--text-3)' }}>
        Not connected to a Pincer backend — scheduled tasks and the journal are empty. Sign in
        again to see the real data.
      </p>
      <Link to="/login" className="plat-btn !h-8 !px-4 !text-xs">
        Connect (Login → Token)
      </Link>
    </div>
  );
}

// ── Scheduled (REAL: /api/schedules) ─────────────────────────────────

function ScheduledTable() {
  const { data, isLoading } = useSchedules(true);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('All');
  const [status, setStatus] = useState('All');
  const [channel, setChannel] = useState('All');
  const [sortField, setSortField] = useState('next');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<ScheduledTask | null>(null);

  const channels = useMemo(
    () => ['All', ...Array.from(new Set((data?.tasks ?? []).map(t => t.channel))).sort()],
    [data],
  );

  const onSort = (f: string) => {
    if (sortField === f) setSortAsc(a => !a);
    else { setSortField(f); setSortAsc(true); }
    setPage(1);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const key = (t: ScheduledTask) =>
      sortField === 'name' ? t.name.toLowerCase()
      : sortField === 'last' ? (t.last_run_at ?? '')
      : (t.next_run_at ?? '9999');
    return (data?.tasks ?? [])
      .filter(t => {
        if (kind !== 'All' && (kind === 'Recurring') !== (t.kind === 'recurring')) return false;
        if (status !== 'All' && (status === 'Enabled') !== t.enabled) return false;
        if (channel !== 'All' && t.channel !== channel) return false;
        if (q && !`${t.name} ${t.channel} ${t.cron_expr}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const cmp = key(a).localeCompare(key(b));
        return sortAsc ? cmp : -cmp;
      });
  }, [data, search, kind, status, channel, sortField, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const hasFilters = search !== '' || kind !== 'All' || status !== 'All' || channel !== 'All';
  const clearFilters = () => {
    setSearch(''); setKind('All'); setStatus('All'); setChannel('All'); setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-5)' }} />
          <Input
            placeholder="Search scheduled tasks…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className={searchInputCls}
          />
        </div>
        <FilterPill value={kind} options={['All', 'Recurring', 'One-time']} onSelect={v => { setKind(v); setPage(1); }} allLabel="Kind" />
        <FilterPill value={status} options={['All', 'Enabled', 'Disabled']} onSelect={v => { setStatus(v); setPage(1); }} allLabel="Status" />
        <FilterPill value={channel} options={channels} onSelect={v => { setChannel(v); setPage(1); }} allLabel="Channel" />
        <span className="ml-auto text-xs" style={{ color: 'var(--text-4)' }}>
          {data ? `${filtered.length} of ${data.tasks.length}` : ''}
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-2 font-medium underline-offset-2 hover:underline"
              style={{ color: 'var(--ink)' }}
            >
              Clear filters
            </button>
          )}
        </span>
      </div>

      <Card className="overflow-hidden rounded-[14px] border-[color:var(--line-soft)] bg-[color:var(--paper)] shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[color:var(--line-soft)] bg-[color:var(--sand)]">
                <SortHeader label="Task" field="name" sortField={sortField} sortAsc={sortAsc} onSort={onSort} />
                <th className={thCls}>Kind</th>
                <th className={cn(thCls, 'hidden md:table-cell')}>Channel</th>
                <SortHeader label="Next run" field="next" sortField={sortField} sortAsc={sortAsc} onSort={onSort} />
                <SortHeader label="Last run" field="last" sortField={sortField} sortAsc={sortAsc} onSort={onSort} className="hidden lg:table-cell" />
                <th className={thCls}>Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--text-4)' }}>Loading…</td></tr>
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--text-4)' }}>
                    {data?.tasks.length ? 'Nothing matches the current filters.' : 'No scheduled tasks yet — create one from Chat ("remind me…", "every morning…").'}
                  </td>
                </tr>
              ) : (
                paged.map((t: ScheduledTask) => (
                  <tr
                    key={t.id}
                    onClick={() => setSelected(t)}
                    className="cursor-pointer border-b border-[color:var(--line-soft)] transition-colors last:border-b-0 hover:bg-[rgba(20,22,26,0.02)]"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px]"
                          style={{ background: 'var(--sand)' }}
                        >
                          <CalendarClock className="h-4 w-4" style={{ color: 'var(--ink)' }} />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium" style={{ color: 'var(--ink)' }}>{t.name}</p>
                          <p className="truncate font-mono text-xs" style={{ color: 'var(--text-4)' }}>{t.cron_expr} · {t.timezone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex rounded-full border px-2 py-0.5 text-xs font-medium"
                        style={{ borderColor: 'var(--line)', color: 'var(--text-2)' }}
                      >
                        {t.kind === 'recurring' ? 'Recurring' : 'One-time'}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
                        <MessageSquare className="h-3.5 w-3.5" style={{ color: 'var(--text-5)' }} />
                        {t.channel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-2)' }}>{fmtWhen(t.next_run_at)}</td>
                    <td className="hidden px-4 py-3 text-xs lg:table-cell" style={{ color: 'var(--text-4)' }}>{fmtWhen(t.last_run_at)}</td>
                    <td className="px-4 py-3">
                      <span className={cn('plat-pill', t.enabled ? 'plat-pill-ok' : 'plat-pill-mute')}>
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: t.enabled ? 'var(--ok-fg)' : 'var(--text-5)' }}
                        />
                        {t.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <TableFooter
            page={safePage}
            totalPages={totalPages}
            onPage={setPage}
            pageSize={pageSize}
            onPageSize={n => { setPageSize(n); setPage(1); }}
            totalRows={filtered.length}
          />
        )}
      </Card>

      {selected && <ScheduleDetailModal task={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ── Journal (REAL: /api/audit) ───────────────────────────────────────

function JournalTable() {
  // API max is 500 — deep enough for real client-side paging.
  const { data, isLoading } = useRecentAudit(500);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('All');
  const [result, setResult] = useState('All');
  const [range, setRange] = useState('All');
  const [sortField, setSortField] = useState('when');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const actions = useMemo(
    () => ['All', ...Array.from(new Set((data?.entries ?? []).map(e => e.action))).sort()],
    [data],
  );

  const RANGE_MS: Record<string, number> = {
    'Last 24h': 24 * 3600_000,
    'Last 7 days': 7 * 24 * 3600_000,
    'Last 30 days': 30 * 24 * 3600_000,
  };

  const onSort = (f: string) => {
    if (sortField === f) setSortAsc(a => !a);
    else { setSortField(f); setSortAsc(f !== 'when'); }
    setPage(1);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    const key = (e: AuditEntry): number | string =>
      sortField === 'cost' ? (e.cost_usd ?? -1)
      : sortField === 'duration' ? (e.duration_ms ?? -1)
      : e.timestamp;
    return (data?.entries ?? [])
      .filter(e => {
        if (action !== 'All' && e.action !== action) return false;
        if (result !== 'All' && (result === 'Succeeded') !== e.approved) return false;
        if (range !== 'All' && now - new Date(e.timestamp).getTime() > RANGE_MS[range]) return false;
        if (q) {
          const hay = `${e.action} ${e.tool ?? ''} ${e.input_summary ?? ''} ${e.output_summary ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const av = key(a); const bv = key(b);
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
        return sortAsc ? cmp : -cmp;
      });
  }, [data, search, action, result, range, sortField, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const hasFilters = search !== '' || action !== 'All' || result !== 'All' || range !== 'All';
  const clearFilters = () => {
    setSearch(''); setAction('All'); setResult('All'); setRange('All'); setPage(1);
  };

  // Export exactly what the current filters show — the journal is an audit
  // trail, and "give me this as a file" is a real request.
  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['timestamp', 'action', 'tool', 'input', 'output', 'result', 'cost_usd', 'duration_ms'],
      ...filtered.map(e => [
        e.timestamp, e.action, e.tool ?? '', e.input_summary ?? '', e.output_summary ?? '',
        e.approved ? 'succeeded' : 'failed', e.cost_usd ?? '', e.duration_ms ?? '',
      ]),
    ];
    const blob = new Blob([rows.map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `task-journal-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-5)' }} />
          <Input
            placeholder="Search the journal…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className={searchInputCls}
          />
        </div>
        <FilterPill value={action} options={actions} onSelect={v => { setAction(v); setPage(1); }} allLabel="Action" />
        <FilterPill value={result} options={['All', 'Succeeded', 'Failed']} onSelect={v => { setResult(v); setPage(1); }} allLabel="Result" />
        <FilterPill value={range} options={['All', 'Last 24h', 'Last 7 days', 'Last 30 days']} onSelect={v => { setRange(v); setPage(1); }} allLabel="Time" />
        <Button variant="outline" size="sm" className={cn(filterBtnCls, '!min-w-0')} onClick={exportCsv} disabled={!filtered.length}>
          <span className="flex items-center gap-1.5">
            <Download className="h-3.5 w-3.5 opacity-60" />
            Export CSV
          </span>
        </Button>
        <span className="ml-auto text-xs" style={{ color: 'var(--text-4)' }}>
          {data ? `${filtered.length} of ${data.total} all-time` : ''}
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-2 font-medium underline-offset-2 hover:underline"
              style={{ color: 'var(--ink)' }}
            >
              Clear filters
            </button>
          )}
        </span>
      </div>

      <Card className="overflow-hidden rounded-[14px] border-[color:var(--line-soft)] bg-[color:var(--paper)] shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[color:var(--line-soft)] bg-[color:var(--sand)]">
                <th className={thCls}>Action</th>
                <th className={cn(thCls, 'hidden md:table-cell')}>Result</th>
                <SortHeader label="Cost" field="cost" sortField={sortField} sortAsc={sortAsc} onSort={onSort} className="hidden lg:table-cell" />
                <SortHeader label="Duration" field="duration" sortField={sortField} sortAsc={sortAsc} onSort={onSort} className="hidden lg:table-cell" />
                <SortHeader label="When" field="when" sortField={sortField} sortAsc={sortAsc} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--text-4)' }}>Loading…</td></tr>
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--text-4)' }}>
                    {data?.entries.length ? 'Nothing matches the current filters.' : 'No actions logged yet.'}
                  </td>
                </tr>
              ) : (
                paged.map((e: AuditEntry) => (
                  <tr
                    key={e.id}
                    onClick={() => setSelected(e)}
                    className="cursor-pointer border-b border-[color:var(--line-soft)] transition-colors last:border-b-0 hover:bg-[rgba(20,22,26,0.02)]"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px]"
                          style={{ background: 'var(--sand)' }}
                        >
                          <Bot className="h-4 w-4" style={{ color: e.approved ? 'var(--ink)' : 'var(--bad-fg)' }} />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium" style={{ color: 'var(--ink)' }}>
                            {e.tool ?? e.action}
                          </p>
                          <p className="truncate text-xs" style={{ color: 'var(--text-3)' }}>
                            {e.input_summary ?? e.action}
                            {e.output_summary && <span style={{ color: 'var(--text-5)' }}> → {e.output_summary}</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <span
                        className={cn('plat-pill', e.approved && 'plat-pill-ok')}
                        style={
                          e.approved
                            ? undefined
                            : { background: 'rgba(179,56,46,0.1)', color: 'var(--bad-fg)' }
                        }
                      >
                        {e.approved ? 'Succeeded' : 'Failed'}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 text-xs lg:table-cell" style={{ color: 'var(--text-3)' }}>{fmtUsd(e.cost_usd)}</td>
                    <td className="hidden px-4 py-3 text-xs lg:table-cell" style={{ color: 'var(--text-3)' }}>{fmtDurationMs(e.duration_ms)}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-4)' }}>
                        <Clock className="h-3 w-3" style={{ color: 'var(--text-5)' }} />
                        {timeAgo(e.timestamp)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <TableFooter
            page={safePage}
            totalPages={totalPages}
            onPage={setPage}
            pageSize={pageSize}
            onPageSize={n => { setPageSize(n); setPage(1); }}
            totalRows={filtered.length}
          />
        )}
      </Card>

      {selected && <JournalDetailModal entry={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

const TasksInner = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('scheduled');
  const connected = isConnected();

  const { data: schedules } = useSchedules(true);
  const { data: audit } = useRecentAudit(100);

  const tabs = [
    { key: 'scheduled' as TabKey, label: `Scheduled${schedules ? ` (${schedules.total})` : ''}`, icon: Activity },
    { key: 'journal' as TabKey, label: `Journal${audit ? ` (${audit.total})` : ''}`, icon: BookMarked },
  ];

  return (
    <div className="plat flex min-h-screen flex-col">
      <SidebarProvider>
        <div className="flex w-full flex-1">
          <AppSidebar />
          <SidebarInset className="flex flex-1 flex-col bg-transparent">
            <main className="mx-auto w-full max-w-6xl flex-1 p-6 pb-20 lg:p-8">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <p className="plat-crumb">3days.tasks</p>
                  <h1 className="mt-1 text-2xl">Tasks</h1>
                  <p className="mt-1 text-sm" style={{ color: 'var(--text-4)' }}>
                    What your agent has scheduled, and everything it has done
                  </p>
                </div>
              </div>

              {!connected && <ConnectStrip />}

              {/* Tab nav */}
              <div className="mb-6 flex items-center gap-1.5 border-b py-2" style={{ borderColor: 'var(--line-soft)' }}>
                {tabs.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={cn(
                      'flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors',
                      activeTab === key
                        ? 'border-transparent bg-[color:var(--ink)] text-white hover:opacity-90'
                        : 'border-[color:var(--line)] text-[color:var(--text-2)] hover:bg-[rgba(20,22,26,0.04)] hover:text-[color:var(--ink)]'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {activeTab === 'scheduled' && <ScheduledTable />}
              {activeTab === 'journal' && <JournalTable />}
            </main>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  );
};

const Tasks = () => (
  <QueryClientProvider client={queryClient}>
    <TasksInner />
  </QueryClientProvider>
);

export default Tasks;
