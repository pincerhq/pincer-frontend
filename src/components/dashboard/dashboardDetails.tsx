/**
 * The expanded views behind the dashboard cards: diagrams on top, the tables
 * behind them underneath. They pull a wider window of the same endpoints the
 * cards use (30 days, 200 audit rows) and only while the detail is open.
 */
import { useMemo } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import {
  useAgentStatus,
  liveAgentStatus,
  useAuditDaily,
  useAuditStats,
  useCostHistory,
  useCostsByModel,
  useCostsByTool,
  useRecentAudit,
  useSchedules,
  useSkills,
  useTodayCosts,
  type AuditDay,
  type AuditEntry,
  type ScheduledTask,
} from '@/lib/api/dashboard';
import {
  DataTable,
  DetailCharts,
  DetailDivider,
  DetailStats,
  DetailTables,
  type Column,
} from './DetailView';
import { Figure, Legend, RankBars, StatusBars, TimeSeries, type Point } from './DashCharts';
import {
  dateTime,
  dayKey,
  fillDays,
  fmtMs,
  fmtNum,
  fmtUsd,
  fmtUsdTick,
  isInternalTool,
  lastDays,
  longDay,
  shortDay,
  timeAgo,
  todayIso,
} from './dashFormat';

const HISTORY_DAYS = 30;

/** Sorted pairs out of the `by_*` maps the API returns. */
function ranked(map: Record<string, number> | undefined, limit = 8) {
  return Object.entries(map ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }));
}

/** Audit rows bucketed per day, split approved / failed. */
function bucketAudit(entries: AuditEntry[], days: number) {
  const keys = lastDays(days);
  const acc = new Map(keys.map((k) => [k, { ok: 0, bad: 0 }]));
  for (const e of entries) {
    const d = new Date(e.timestamp);
    if (isNaN(d.getTime())) continue;
    const slot = acc.get(dayKey(d));
    if (!slot) continue;
    if (e.approved) slot.ok += 1;
    else slot.bad += 1;
  }
  return keys.map((k) => ({ label: shortDay(k), full: longDay(k), ...acc.get(k)! }));
}

/**
 * The daily bars. Counted per day where the backend can count them, and
 * bucketed from the page of rows only as a fallback — that page is the newest
 * N actions, which on a busy agent is minutes of history, not fourteen days.
 */
function dailyBuckets(daily: AuditDay[] | undefined, entries: AuditEntry[] | undefined, days: number) {
  if (!daily) return bucketAudit(entries ?? [], days);
  return daily.map((d) => ({
    label: shortDay(d.date),
    full: longDay(d.date),
    ok: Math.max(0, d.total - d.failed),
    bad: d.failed,
  }));
}

function ResultPill({ ok }: { ok: boolean }) {
  return (
    <span className={`plat-pill ${ok ? 'plat-pill-ok' : ''}`} style={ok ? undefined : { background: 'var(--warn-bg)', color: 'var(--bad-fg)' }}>
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {ok ? 'approved' : 'failed'}
    </span>
  );
}

// ── Spend ────────────────────────────────────────────────────────────

export function SpendDetail() {
  const { data: history } = useCostHistory(HISTORY_DAYS);
  const { data: models } = useCostsByModel(HISTORY_DAYS);
  const { data: tools } = useCostsByTool(HISTORY_DAYS);
  const { data: today } = useTodayCosts();
  // Fallback for the tool panel: the backend prices per model, not per tool,
  // so when the cost breakdown comes back empty the audit log still knows
  // which tools ran over the same window.
  const windowStart = useMemo(() => lastDays(HISTORY_DAYS)[0], []);
  const { data: toolActivity } = useAuditStats(windowStart);

  const daily = useMemo(() => fillDays(history?.data, HISTORY_DAYS), [history]);

  const series: Point[] = useMemo(
    () =>
      daily.map((d) => ({
        label: shortDay(d.date),
        full: longDay(d.date),
        value: d.total_usd,
        sub: `${fmtNum(d.request_count)} requests`,
      })),
    [daily],
  );

  const requestSeries: Point[] = useMemo(
    () =>
      daily.map((d) => ({
        label: shortDay(d.date),
        full: longDay(d.date),
        value: d.request_count,
        sub: fmtUsd(d.total_usd),
      })),
    [daily],
  );

  const topModel = models?.models?.[0];
  const dailyRows = useMemo(() => [...(history?.data ?? [])].reverse(), [history]);

  // The API averages over the days it has rows for; the window average is
  // total over every day in the window, including the quiet ones.
  const windowAvg = history ? history.totals.total_usd / Math.max(daily.length, 1) : undefined;

  /** Priced per tool where the backend can, call counts where it cannot. */
  const priced = useMemo(() => tools?.tools ?? [], [tools]);
  const toolRows = useMemo(() => {
    if (priced.length) {
      return priced.map((t) => ({ tool: t.tool, usd: t.total_usd, calls: t.call_count, avg: t.avg_cost }));
    }
    return Object.entries(toolActivity?.by_tool ?? {})
      .filter(([name]) => !isInternalTool(name))
      .sort((a, b) => b[1] - a[1])
      .map(([tool, calls]) => ({ tool, usd: null, calls, avg: null }));
  }, [priced, toolActivity]);
  const toolCalls = toolRows.reduce((n, r) => n + r.calls, 0);

  return (
    <>
      <DetailStats
        items={[
          { label: `Last ${HISTORY_DAYS}d`, value: fmtUsd(history?.totals.total_usd), sub: `${fmtNum(history?.totals.total_requests)} requests` },
          { label: 'Average day', value: fmtUsd(windowAvg), sub: `across ${daily.length} days` },
          {
            label: 'Today',
            value: fmtUsd(today?.total_usd),
            sub: today ? `${Math.round(today.budget.spent_pct)}% of ${fmtUsd(today.budget.daily_limit)} budget` : 'waiting for data',
          },
          {
            label: 'Costliest model',
            value: <span className="font-mono text-[15px]">{topModel ? topModel.model : '—'}</span>,
            sub: topModel ? `${fmtUsd(topModel.total_usd)} · ${fmtNum(topModel.request_count)} requests` : undefined,
          },
        ]}
      />

      <DetailDivider label="Diagrams" hint={`last ${HISTORY_DAYS} days`} />
      <DetailCharts>
        <Figure title="Spend per day" hint={history ? fmtUsd(history.totals.total_usd) + ' total' : undefined}>
          <TimeSeries data={series} kind="area" height={210} format={fmtUsdTick} yLabel="spend per day in USD" />
        </Figure>
        <Figure title="Cost by model" hint="share of spend">
          <div className="pt-1">
            <RankBars
              rows={(models?.models ?? []).slice(0, 6).map((m) => ({
                label: m.model,
                value: m.total_usd,
                sub: `${fmtNum(m.request_count)} req`,
              }))}
              format={fmtUsd}
              color="var(--brand)"
              emptyLabel="No model costs recorded yet"
            />
          </div>
        </Figure>
        <Figure
          title={priced.length ? 'Cost by tool' : 'Tool calls'}
          hint={
            priced.length
              ? 'what the agent spends money doing'
              : `${fmtNum(toolCalls)} calls · cost is tracked per model, not per tool`
          }
        >
          <div className="pt-1">
            <RankBars
              rows={toolRows.slice(0, 6).map((t) => ({
                label: t.tool,
                value: t.usd ?? t.calls,
                sub: t.usd != null ? `${fmtNum(t.calls)} calls` : undefined,
              }))}
              format={priced.length ? fmtUsd : (n) => fmtNum(Math.round(n))}
              emptyLabel="No tool calls recorded yet"
            />
          </div>
        </Figure>
        <Figure title="Requests per day" hint="volume behind the spend">
          <TimeSeries
            data={requestSeries}
            kind="bar"
            height={210}
            format={(n) => fmtNum(Math.round(n))}
            yLabel="requests per day"
          />
        </Figure>
      </DetailCharts>

      <DetailDivider label="Data" hint="every row behind the charts" />
      <DetailTables cols={2}>
        <DataTable
          title="By model"
          hint={`${models?.models.length ?? 0} models`}
          rows={models?.models ?? []}
          rowKey={(m) => m.model}
          columns={[
            { key: 'model', label: 'Model', render: (m) => <span className="font-mono">{m.model}</span> },
            { key: 'req', label: 'Requests', num: true, render: (m) => fmtNum(m.request_count) },
            { key: 'tok', label: 'Tokens', num: true, render: (m) => fmtNum(m.total_tokens) },
            { key: 'avg', label: 'Avg / req', num: true, render: (m) => fmtUsd(m.avg_cost_per_request) },
            { key: 'total', label: 'Total', num: true, render: (m) => fmtUsd(m.total_usd) },
          ]}
          empty="No model costs recorded yet"
        />
        <DataTable
          title="By tool"
          hint={`${toolRows.length} tools`}
          rows={toolRows}
          rowKey={(t) => t.tool}
          columns={[
            { key: 'tool', label: 'Tool', render: (t) => <span className="font-mono">{t.tool}</span> },
            { key: 'calls', label: 'Calls', num: true, render: (t) => fmtNum(t.calls) },
            // Two columns of dashes say nothing: drop them until costs are priced.
            ...(priced.length
              ? [
                  { key: 'avg', label: 'Avg', num: true, render: (t) => fmtUsd(t.avg) },
                  { key: 'total', label: 'Total', num: true, render: (t) => fmtUsd(t.usd) },
                ]
              : []),
          ]}
          empty="No tool calls recorded yet"
        />
      </DetailTables>
      <DataTable
        title="Day by day"
        hint="newest first"
        rows={dailyRows}
        rowKey={(d) => d.date}
        maxHeight={320}
        columns={[
          { key: 'date', label: 'Date', render: (d) => <span className="font-mono">{d.date}</span> },
          { key: 'req', label: 'Requests', num: true, render: (d) => fmtNum(d.request_count) },
          {
            key: 'avg',
            label: 'Avg / req',
            num: true,
            render: (d) => fmtUsd(d.total_usd / Math.max(d.request_count, 1)),
          },
          { key: 'spend', label: 'Spend', num: true, render: (d) => fmtUsd(d.total_usd) },
        ]}
        empty="No spend recorded yet"
      />
    </>
  );
}

// ── Requests ─────────────────────────────────────────────────────────

export function RequestsDetail() {
  const { data: history } = useCostHistory(HISTORY_DAYS);
  const { data: models } = useCostsByModel(HISTORY_DAYS);
  const { data: today } = useTodayCosts();

  const bars: Point[] = useMemo(
    () =>
      (history?.data ?? []).map((d) => ({
        label: shortDay(d.date),
        full: longDay(d.date),
        value: d.request_count,
        sub: fmtUsd(d.total_usd),
      })),
    [history],
  );

  const busiest = useMemo(
    () => [...(history?.data ?? [])].sort((a, b) => b.request_count - a.request_count)[0],
    [history],
  );

  return (
    <>
      <DetailStats
        items={[
          { label: 'Today', value: fmtNum(today?.request_count), sub: today ? `${fmtUsd(today.total_usd / Math.max(today.request_count, 1))} average each` : 'waiting for data' },
          { label: `Last ${HISTORY_DAYS}d`, value: fmtNum(history?.totals.total_requests), sub: `${fmtUsd(history?.totals.total_usd)} spent` },
          {
            label: 'Busiest day',
            value: busiest ? fmtNum(busiest.request_count) : '—',
            sub: busiest ? longDay(busiest.date) : undefined,
          },
          { label: 'Models in use', value: fmtNum(models?.models.length), sub: 'over the window' },
        ]}
      />

      <DetailDivider label="Diagrams" hint={`last ${HISTORY_DAYS} days`} />
      <DetailCharts>
        <Figure title="Requests per day" hint={history ? `${fmtNum(history.totals.total_requests)} total` : undefined}>
          <TimeSeries data={bars} kind="bar" height={210} format={(n) => fmtNum(Math.round(n))} yLabel="requests per day" />
        </Figure>
        <Figure title="Requests by model" hint="who is answering">
          <div className="pt-1">
            <RankBars
              rows={(models?.models ?? []).slice(0, 6).map((m) => ({
                label: m.model,
                value: m.request_count,
                sub: fmtUsd(m.avg_cost_per_request) + ' / req',
              }))}
              format={(n) => fmtNum(Math.round(n))}
              color="var(--brand)"
              emptyLabel="No requests recorded yet"
            />
          </div>
        </Figure>
      </DetailCharts>

      <DetailDivider label="Data" />
      <DetailTables cols={2}>
        <DataTable
          title="By model"
          rows={models?.models ?? []}
          rowKey={(m) => m.model}
          columns={[
            { key: 'model', label: 'Model', render: (m) => <span className="font-mono">{m.model}</span> },
            { key: 'req', label: 'Requests', num: true, render: (m) => fmtNum(m.request_count) },
            { key: 'tok', label: 'Tokens', num: true, render: (m) => fmtNum(m.total_tokens) },
            { key: 'avg', label: 'Avg / req', num: true, render: (m) => fmtUsd(m.avg_cost_per_request) },
          ]}
          empty="No requests recorded yet"
        />
        <DataTable
          title="Today by model"
          hint={todayIso()}
          rows={Object.entries(today?.by_model ?? {}).sort((a, b) => b[1] - a[1])}
          rowKey={([model]) => model}
          columns={[
            { key: 'model', label: 'Model', render: ([model]) => <span className="font-mono">{model}</span> },
            { key: 'usd', label: 'Spent today', num: true, render: ([, usd]) => fmtUsd(usd) },
          ]}
          empty="Nothing spent today yet"
        />
      </DetailTables>
    </>
  );
}

// ── Actions / activity log ───────────────────────────────────────────

export function ActivityDetail() {
  const { data: audit } = useRecentAudit(200);
  const { data: daily } = useAuditDaily(14);
  const { data: allStats } = useAuditStats();
  const { data: todayStats } = useAuditStats(todayIso());

  const entries = audit?.entries ?? [];
  const buckets = useMemo(() => dailyBuckets(daily, audit?.entries, 14), [daily, audit]);
  const failed = allStats?.failed_actions ?? 0;
  const total = allStats?.total_entries ?? 0;

  const auditColumns: Column<AuditEntry>[] = [
    {
      key: 'when',
      label: 'When',
      width: '132px',
      render: (e) => (
        <span title={dateTime(e.timestamp)} className="whitespace-nowrap font-mono text-[11.5px]">
          {timeAgo(e.timestamp)}
        </span>
      ),
      value: (e) => e.timestamp,
    },
    { key: 'action', label: 'Action', render: (e) => <span className="font-medium" style={{ color: 'var(--ink)' }}>{e.action}</span> },
    { key: 'tool', label: 'Tool', render: (e) => <span className="font-mono text-[11.5px]">{e.tool ?? '—'}</span> },
    {
      key: 'summary',
      label: 'Detail',
      render: (e) => (
        <span className="line-clamp-2 max-w-[420px]">
          {e.input_summary || e.output_summary || '—'}
        </span>
      ),
    },
    { key: 'result', label: 'Result', render: (e) => <ResultPill ok={e.approved} /> },
    { key: 'dur', label: 'Duration', num: true, render: (e) => fmtMs(e.duration_ms) },
    { key: 'cost', label: 'Cost', num: true, render: (e) => fmtUsd(e.cost_usd) },
  ];

  return (
    <>
      <DetailStats
        items={[
          { label: 'All time', value: fmtNum(total), sub: `${fmtUsd(allStats?.total_cost_usd)} spent on actions` },
          { label: 'Today', value: fmtNum(todayStats?.total_entries), sub: todayStats ? `${todayStats.failed_actions} failed` : 'waiting for data' },
          {
            label: 'Failures',
            value: fmtNum(failed),
            sub: total ? `${((failed / total) * 100).toFixed(1)}% of all actions` : undefined,
          },
          { label: 'Distinct tools', value: fmtNum(Object.keys(allStats?.by_tool ?? {}).length), sub: 'used at least once' },
        ]}
      />

      <DetailDivider label="Diagrams" hint="last 14 days · every audited action" />
      <DetailCharts>
        <Figure
          title="Actions per day"
          hint={<Legend items={[{ color: 'var(--ink)', label: 'approved' }, { color: 'var(--bad-fg)', label: 'failed' }]} />}
        >
          <StatusBars data={buckets} height={210} />
        </Figure>
        <Figure title="Most used tools" hint="all time">
          <div className="pt-1">
            <RankBars
              rows={ranked(allStats?.by_tool, 6)}
              format={(n) => fmtNum(Math.round(n))}
              emptyLabel="No tool calls recorded yet"
            />
          </div>
        </Figure>
        <Figure title="Actions by type" hint="all time" className="lg:col-span-2">
          <div className="pt-1">
            <RankBars
              rows={ranked(allStats?.by_action, 8)}
              format={(n) => fmtNum(Math.round(n))}
              color="var(--brand)"
              emptyLabel="No actions recorded yet"
            />
          </div>
        </Figure>
      </DetailCharts>

      <DetailDivider label="Data" hint="full audit log" />
      <DataTable
        title="Audit log"
        hint={audit ? `${fmtNum(entries.length)} of ${fmtNum(audit.total)} actions` : undefined}
        rows={entries}
        rowKey={(e) => String(e.id)}
        columns={auditColumns}
        maxHeight={420}
        empty="Nothing yet — actions your agent takes will appear here"
      />
    </>
  );
}

// ── Agent ────────────────────────────────────────────────────────────

export function AgentDetail() {
  const { st, unreachable } = liveAgentStatus(useAgentStatus());
  const { data: audit } = useRecentAudit(60);
  const { data: daily } = useAuditDaily(14);
  const { data: stats } = useAuditStats();

  const channels = Object.entries(st?.channels ?? {});
  const online = channels.filter(([, on]) => on).length;
  const entries = audit?.entries ?? [];
  const buckets = useMemo(() => dailyBuckets(daily, audit?.entries, 14), [daily, audit]);

  return (
    <>
      <DetailStats
        items={[
          unreachable
            ? { label: 'Runtime', value: 'Not reachable', sub: 'last status check failed' }
            : { label: 'Runtime', value: st ? (st.agent_running ? 'Running' : 'Stopped') : '—', sub: st ? `version ${st.version}` : 'waiting for data' },
          { label: 'Channels on', value: unreachable ? '—' : `${online}/${channels.length || 0}`, sub: channels.length ? channels.map(([n]) => n).join(', ') : undefined },
          { label: 'Actions all time', value: fmtNum(stats?.total_entries), sub: `${fmtNum(stats?.failed_actions)} failed` },
          { label: 'Tools available', value: fmtNum(Object.keys(stats?.by_tool ?? {}).length), sub: 'seen in the audit log' },
        ]}
      />

      <DetailDivider label="Diagrams" />
      <DetailCharts>
        <Figure
          title="Agent activity"
          hint={<Legend items={[{ color: 'var(--ink)', label: 'approved' }, { color: 'var(--bad-fg)', label: 'failed' }]} />}
        >
          <StatusBars data={buckets} height={200} emptyLabel="No recent agent activity" />
        </Figure>
        <Figure title="What it spends its time on" hint="tool calls, all time">
          <div className="pt-1">
            <RankBars rows={ranked(stats?.by_tool, 6)} format={(n) => fmtNum(Math.round(n))} emptyLabel="No tool calls yet" />
          </div>
        </Figure>
      </DetailCharts>

      <DetailDivider label="Data" />
      <DetailTables cols={2}>
        <DataTable
          title="Channels"
          hint={unreachable ? 'state unknown' : `${online} online`}
          rows={channels}
          rowKey={([name]) => name}
          columns={[
            { key: 'name', label: 'Channel', render: ([name]) => <span className="capitalize">{name}</span> },
            {
              key: 'state',
              label: 'State',
              render: ([, on]) => (
                <span className={`plat-pill ${on ? 'plat-pill-ok' : 'plat-pill-mute'}`}>{on ? 'on' : 'off'}</span>
              ),
            },
          ]}
          empty="No channel information from the backend"
        />
        <DataTable
          title="Latest actions"
          rows={entries.slice(0, 25)}
          rowKey={(e) => String(e.id)}
          columns={[
            {
              key: 'when',
              label: 'When',
              render: (e) => <span className="font-mono text-[11.5px]">{timeAgo(e.timestamp)}</span>,
              value: (e) => e.timestamp,
            },
            { key: 'tool', label: 'Tool / action', render: (e) => <span className="font-mono text-[11.5px]">{e.tool ?? e.action}</span> },
            { key: 'result', label: 'Result', render: (e) => <ResultPill ok={e.approved} /> },
            { key: 'cost', label: 'Cost', num: true, render: (e) => fmtUsd(e.cost_usd) },
          ]}
          empty="No actions yet"
        />
      </DetailTables>
    </>
  );
}

// ── Automation: schedules + skills ───────────────────────────────────

export function AutomationDetail() {
  const { data: schedules } = useSchedules(true);
  const { data: skills } = useSkills();

  const tasks = schedules?.tasks ?? [];

  /** Upcoming runs bucketed into the next 14 days. */
  const upcoming = useMemo(() => {
    const keys = lastDays(1).concat(
      Array.from({ length: 13 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + i + 1);
        return dayKey(d);
      }),
    );
    const acc = new Map(keys.map((k) => [k, 0]));
    for (const t of schedules?.tasks ?? []) {
      if (!t.enabled || !t.next_run_at) continue;
      const d = new Date(t.next_run_at);
      if (isNaN(d.getTime())) continue;
      const k = dayKey(d);
      if (acc.has(k)) acc.set(k, (acc.get(k) ?? 0) + 1);
    }
    return keys.map((k) => ({ label: shortDay(k), full: longDay(k), value: acc.get(k) ?? 0 }));
  }, [schedules]);

  const byChannel = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const t of schedules?.tasks ?? []) acc[t.channel || 'unknown'] = (acc[t.channel || 'unknown'] ?? 0) + 1;
    return ranked(acc, 6);
  }, [schedules]);

  const taskColumns: Column<ScheduledTask>[] = [
    { key: 'name', label: 'Task', render: (t) => <span className="font-medium" style={{ color: 'var(--ink)' }}>{t.name}</span> },
    { key: 'kind', label: 'Kind', render: (t) => <span className="font-mono text-[11.5px]">{t.kind}</span> },
    { key: 'cron', label: 'Schedule', render: (t) => <span className="font-mono text-[11.5px]">{t.cron_expr}</span> },
    { key: 'tz', label: 'Timezone', render: (t) => <span className="text-[11.5px]">{t.timezone}</span> },
    { key: 'channel', label: 'Channel', render: (t) => <span className="capitalize">{t.channel}</span> },
    {
      key: 'enabled',
      label: 'State',
      render: (t) => <span className={`plat-pill ${t.enabled ? 'plat-pill-ok' : 'plat-pill-mute'}`}>{t.enabled ? 'enabled' : 'paused'}</span>,
    },
    {
      key: 'last',
      label: 'Last run',
      render: (t) => <span className="whitespace-nowrap text-[11.5px]">{t.last_run_at ? timeAgo(t.last_run_at) : '—'}</span>,
      value: (t) => t.last_run_at ?? '',
    },
    {
      key: 'next',
      label: 'Next run',
      render: (t) => <span className="whitespace-nowrap text-[11.5px]">{dateTime(t.next_run_at)}</span>,
      value: (t) => t.next_run_at ?? '',
    },
  ];

  return (
    <>
      <DetailStats
        items={[
          { label: 'Scheduled', value: fmtNum(schedules?.total), sub: `${fmtNum(schedules?.future_count)} still to run` },
          { label: 'Enabled', value: fmtNum(tasks.filter((t) => t.enabled).length), sub: `${tasks.filter((t) => !t.enabled).length} paused` },
          { label: 'Already run', value: fmtNum(schedules?.past_count), sub: 'in this window' },
          { label: 'Skills installed', value: fmtNum(skills?.skills.length), sub: 'extend what agents can do' },
        ]}
      />

      <DetailDivider label="Diagrams" hint="next 14 days" />
      <DetailCharts>
        <Figure title="Upcoming runs" hint="enabled tasks only">
          <TimeSeries
            data={upcoming}
            kind="bar"
            height={200}
            format={(n) => String(Math.round(n))}
            emptyLabel="Nothing scheduled"
            yLabel="scheduled runs per day"
          />
        </Figure>
        <Figure title="Tasks by channel" hint="where automation lands">
          <div className="pt-1">
            <RankBars rows={byChannel} format={(n) => String(Math.round(n))} emptyLabel="No scheduled tasks yet" />
          </div>
        </Figure>
      </DetailCharts>

      <DetailDivider label="Data" />
      <DataTable
        title="Scheduled tasks"
        hint={`${tasks.length} total`}
        rows={tasks}
        rowKey={(t) => String(t.id)}
        columns={taskColumns}
        maxHeight={340}
        empty="No scheduled tasks yet"
      />
      <DataTable
        title="Skills"
        hint={`${skills?.skills.length ?? 0} installed`}
        rows={skills?.skills ?? []}
        rowKey={(s) => s.dir}
        maxHeight={300}
        columns={[
          { key: 'name', label: 'Skill', render: (s) => <span className="font-mono text-[11.5px]" style={{ color: 'var(--ink)' }}>{s.name}</span> },
          { key: 'desc', label: 'What it does', render: (s) => <span className="line-clamp-2 max-w-[520px]">{s.description}</span> },
          { key: 'status', label: 'Status', render: (s) => <span className="plat-pill plat-pill-mute">{s.status}</span> },
          { key: 'source', label: 'Source', render: (s) => <span className="text-[11.5px]">{s.source}</span> },
        ]}
        empty="No skills installed"
      />
    </>
  );
}

// ── Workforce (still mocked — kept visibly demo) ─────────────────────

const WORKFORCE_MONTHS = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
const WORKFORCE_AI = [11, 14, 17, 19, 22, 24];
const WORKFORCE_HUMAN = [9, 9, 8, 9, 9, 9];
const WORKFORCE_TEAMS = [
  { team: 'Support', ai: 9, human: 3, tasks: 1284, productivity: '412%' },
  { team: 'Sales', ai: 7, human: 4, tasks: 863, productivity: '337%' },
  { team: 'Finance', ai: 5, human: 1, tasks: 402, productivity: '288%' },
  { team: 'Operations', ai: 3, human: 1, tasks: 219, productivity: '241%' },
];
