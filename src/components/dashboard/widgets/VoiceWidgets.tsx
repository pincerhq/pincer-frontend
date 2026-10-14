/**
 * Voice-side widgets: the line itself, the calls that ran over it, and the
 * numbers on both ends. All three read `/api/voice/*` — the same endpoints the
 * telephony app uses, summarised for the dashboard.
 */
import { useMemo } from 'react';
import { PhoneCall } from 'lucide-react';
import {
  useActiveCalls,
  useCallHistoryAll,
  useContacts,
  useVoiceStatus,
  type CallSummary,
} from '@/lib/api/voice';
import { RankBars, TimeSeries, type Point } from '../DashCharts';
import { dayKey, fmtDuration, fmtNum, fmtUsd, lastDays, longDay, shortDay } from '../dashFormat';
import { WidgetEmpty, WidgetPlot, WidgetRows, WidgetStats } from './widgetKit';

const CALL_WINDOW = 14;

/** Calls bucketed per local day across the window, quiet days included. */
function callsPerDay(calls: CallSummary[], days: number) {
  const keys = lastDays(days);
  const acc = new Map(keys.map((k) => [k, 0]));
  for (const c of calls) {
    const d = new Date(c.started_at);
    if (isNaN(d.getTime())) continue;
    const k = dayKey(d);
    if (acc.has(k)) acc.set(k, (acc.get(k) ?? 0) + 1);
  }
  return keys.map<Point>((k) => ({ label: shortDay(k), full: longDay(k), value: acc.get(k) ?? 0 }));
}

const isToday = (c: CallSummary) => {
  const d = new Date(c.started_at);
  return !isNaN(d.getTime()) && dayKey(d) === dayKey(new Date());
};

// ── Voice ────────────────────────────────────────────────────────────

export function VoiceWidget() {
  const { data: status } = useVoiceStatus();
  const { data: active } = useActiveCalls();
  const { calls } = useCallHistoryAll(200);

  const today = useMemo(() => calls.filter(isToday), [calls]);
  const todaySeconds = today.reduce((n, c) => n + (c.duration_seconds ?? 0), 0);
  const live = active?.length ?? status?.active_call_count ?? 0;

  return (
    <>
      <WidgetStats
        items={[
          { label: 'Live now', value: fmtNum(live), sub: live ? 'on the line' : 'line is idle' },
          { label: 'Calls today', value: fmtNum(today.length), sub: fmtDuration(todaySeconds) + ' talking' },
          {
            label: 'Engine',
            value: <span className="font-mono text-[14px]">{status?.engine ?? '—'}</span>,
            sub: status ? `${status.language} · ${status.consent_mode.replace('_', ' ')}` : 'waiting for data',
          },
        ]}
      />

      {active?.length ? (
        <div className="mt-4 space-y-2">
          {active.slice(0, 3).map((c) => (
            <div key={c.call_sid} className="flex items-center gap-2.5 rounded-[10px] px-3 py-2" style={{ background: 'var(--sand)' }}>
              <PhoneCall className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--ok-fg, var(--ink))' }} />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                {c.target_name || c.caller_number || c.target_number}
              </span>
              <span className="font-mono text-[11px]" style={{ color: 'var(--text-4)' }}>
                {fmtDuration(c.duration_seconds)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <WidgetRows
          rows={[
            { label: 'Outbound calling', value: status?.outbound_enabled ? 'enabled' : 'off' },
            {
              label: 'Daily outbound used',
              value:
                status?.daily_calls_used == null
                  ? '—'
                  : `${fmtNum(status.daily_calls_used)}${status.daily_calls_limit ? ` / ${fmtNum(status.daily_calls_limit)}` : ''}`,
            },
            {
              label: 'Webhook',
              value: status?.webhook_base_configured ? 'configured' : 'not configured',
            },
          ]}
        />
      )}
    </>
  );
}

// ── Calls ────────────────────────────────────────────────────────────

export function CallsWidget() {
  const { calls, isLoading } = useCallHistoryAll(500);

  const series = useMemo(() => callsPerDay(calls, CALL_WINDOW), [calls]);
  const inWindow = useMemo(() => {
    const keys = new Set(lastDays(CALL_WINDOW));
    return calls.filter((c) => keys.has(dayKey(new Date(c.started_at))));
  }, [calls]);

  const inbound = inWindow.filter((c) => c.direction === 'inbound').length;
  const seconds = inWindow.reduce((n, c) => n + (c.duration_seconds ?? 0), 0);
  const cost = inWindow.reduce((n, c) => n + (c.cost_total_usd ?? 0), 0);
  const failed = inWindow.filter((c) => c.failure_code && c.failure_code !== 'none').length;

  return (
    <>
      <WidgetStats
        items={[
          { label: `Calls · ${CALL_WINDOW}d`, value: fmtNum(inWindow.length), sub: `${fmtNum(inbound)} in · ${fmtNum(inWindow.length - inbound)} out` },
          { label: 'Talk time', value: fmtDuration(seconds), sub: inWindow.length ? `${fmtDuration(seconds / inWindow.length)} average` : undefined },
          { label: 'Cost', value: fmtUsd(cost), sub: failed ? `${fmtNum(failed)} did not complete` : 'all completed' },
        ]}
      />
      <WidgetPlot title="Calls per day" hint={`last ${CALL_WINDOW} days`}>
        <TimeSeries
          data={series}
          kind="bar"
          height={132}
          format={(n) => fmtNum(Math.round(n))}
          yLabel="calls per day"
          emptyLabel={isLoading ? 'Loading call history…' : 'No calls in this period'}
        />
      </WidgetPlot>
    </>
  );
}

// ── Phone numbers ────────────────────────────────────────────────────

export function PhonesWidget() {
  const { calls } = useCallHistoryAll(500);
  const { data: contacts } = useContacts();
  const { data: status } = useVoiceStatus();

  /** Every counterparty the line has actually spoken to, busiest first. */
  const numbers = useMemo(() => {
    const acc = new Map<string, number>();
    for (const c of calls) {
      const other = c.direction === 'inbound' ? c.from_number : c.to_number;
      if (!other) continue;
      acc.set(other, (acc.get(other) ?? 0) + 1);
    }
    const byName = new Map((contacts ?? []).map((k) => [k.phone_number, k.name]));
    return [...acc.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([number, count]) => ({ number, count, name: byName.get(number) }));
  }, [calls, contacts]);

  const optedOut = (contacts ?? []).filter((c) => c.opted_out).length;

  return (
    <>
      <WidgetStats
        items={[
          { label: 'Numbers seen', value: fmtNum(numbers.length), sub: 'across the call history' },
          { label: 'Contacts', value: fmtNum(contacts?.length), sub: optedOut ? `${fmtNum(optedOut)} opted out` : 'saved on the agent' },
          {
            label: 'Do not call',
            value: fmtNum(status?.do_not_call_count ?? optedOut),
            sub: 'numbers the agent refuses',
          },
        ]}
      />
      <WidgetPlot title="Most called" hint="calls per number">
        {numbers.length ? (
          <RankBars
            rows={numbers.slice(0, 5).map((n) => ({
              label: n.number,
              value: n.count,
              sub: n.name,
            }))}
            format={(n) => fmtNum(Math.round(n))}
            color="var(--brand)"
          />
        ) : (
          <WidgetEmpty>No numbers yet — they appear once the line has calls.</WidgetEmpty>
        )}
      </WidgetPlot>
    </>
  );
}
