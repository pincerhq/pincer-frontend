/**
 * Dashboard on REAL backend data from the connected Pincer server:
 * /api/status, /api/costs/*, /api/audit, /api/schedules, /api/skills.
 *
 * Visual language comes from the marketing design system, transposed for the
 * app in src/styles/platform.css (`.plat` scope): mono breadcrumb, Sora
 * numerals in big rounded stat cards, rounded activity rows, hairline-divided
 * giant numbers, squircle icon list rows.
 *
 * Every element is a summary that expands on demand: the card opens a detail
 * view with diagrams on top and the underlying data tables below (see
 * DetailView.tsx / dashboardDetails.tsx).
 *
 * Structure is deliberately simple — three questions, in order:
 *   1. "How is today going?"   → three big numbers with a budget bar
 *   2. "What is it doing?"     → activity rows + spend, left column
 *   3. "What is set up?"       → agent/channels, actions, automation, right rail
 *   4. "What else?"            → a board of dashboards (voice, calls, text,
 *      images, phone numbers…) the person adds from the ＋ gallery and drags
 *      into the order they want — see DashboardBoard.tsx
 *
 * Every section reads an endpoint the backend serves. The Workforce Overview
 * that used to sit at the bottom under a MOCK badge is gone — there is no
 * workforce/teams API, so its headcount and productivity figures were demo
 * numbers with nothing behind them.
 */
import { useMemo } from 'react';
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  CircleAlert,
  Cpu,
  MessageSquare,
  Phone,
  Plug,
  Sparkles,
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/dashboard/AppSidebar';
import { MobileMenuBar } from '@/components/dashboard/MobileMenuBar';
import { queryClient } from '@/lib/queryClient';
import { isConnected } from '@/lib/pincerClient';
import {
  useAgentStatus,
  liveAgentStatus,
  useAuditStats,
  useCostHistory,
  useCostsByModel,
  useRecentAudit,
  useSchedules,
  useSkills,
  useTodayCosts,
} from '@/lib/api/dashboard';
import { cn } from '@/lib/utils';
import { Expandable, useDetail } from '@/components/dashboard/DetailView';
import { SectionHeader } from '@/components/dashboard/SectionHeader';
import { DashboardBoard } from '@/components/dashboard/DashboardBoard';
import {
  ActivityDetail,
  AgentDetail,
  AutomationDetail,
  RequestsDetail,
  SpendDetail,
} from '@/components/dashboard/dashboardDetails';
import { fmtUsd, timeAgo, todayIso } from '@/components/dashboard/dashFormat';
import '@/styles/platform.css';

// ── Connect strip ────────────────────────────────────────────────────

function ConnectStrip() {
  return (
    <div className="plat-panel mb-6 flex flex-wrap items-center gap-3 !py-3.5">
      <Plug className="h-4 w-4 shrink-0" style={{ color: 'var(--text-5)' }} />
      <p className="flex-1 text-xs" style={{ color: 'var(--text-3)' }}>
        Not connected to a Pincer backend — the live sections below are empty. Sign in again
        to see real spend, activity and schedules.
      </p>
      <Link to="/login" className="plat-btn !h-8 !px-4 !text-xs">
        Connect (Login → Token)
      </Link>
    </div>
  );
}

// ── Today: three numbers that answer "how is it going?" ─────────────

function TodayRow() {
  const { data: costs } = useTodayCosts();
  const { data: audit } = useAuditStats(todayIso());

  const pct = costs ? Math.min(100, costs.budget.spent_pct) : 0;
  const downgraded = costs?.budget.is_downgraded ?? false;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {/* Spend + budget in ONE card — the bar makes "18% used" instant */}
      <Expandable
        trigger="card"
        title="Spend"
        subtitle="Where the money goes — daily trend, models, tools"
        detail={<SpendDetail />}
      >
      <div className="plat-stat">
        <p className="plat-num">{costs ? fmtUsd(costs.total_usd) : '—'}</p>
        <p className="plat-stat-label">Spent today</p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--sand-deep)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct}%`,
              background: downgraded || pct >= 90 ? 'var(--warn-fg)' : 'var(--brand)',
            }}
          />
        </div>
        <p className="plat-stat-sub mt-2" style={downgraded ? { color: 'var(--warn-fg)' } : undefined}>
          {costs
            ? downgraded
              ? '⚠ over budget — downgraded to cheaper models'
              : `${Math.round(pct)}% of ${fmtUsd(costs.budget.daily_limit)} budget · ${fmtUsd(costs.budget.remaining)} left`
            : 'waiting for data'}
        </p>
      </div>
      </Expandable>

      <Expandable
        trigger="card"
        title="Requests"
        subtitle="AI request volume, day by day and by model"
        detail={<RequestsDetail />}
      >
      <div className="plat-stat">
        <p className="plat-num">{costs ? costs.request_count : '—'}</p>
        <p className="plat-stat-label">AI requests</p>
        <p className="plat-stat-sub">
          {costs
            ? `${fmtUsd(costs.total_usd / Math.max(costs.request_count, 1))} average each`
            : 'waiting for data'}
        </p>
      </div>
      </Expandable>

      <Expandable
        trigger="card"
        title="Actions"
        subtitle="Everything the agent did, and how much of it worked"
        detail={<ActivityDetail />}
      >
      <div className="plat-stat">
        <p className="plat-num">{audit ? audit.total_entries : '—'}</p>
        <p className="plat-stat-label">Actions completed</p>
        <p
          className="plat-stat-sub"
          style={audit && audit.failed_actions > 0 ? { color: 'var(--bad-fg)', fontWeight: 500 } : undefined}
        >
          {audit
            ? audit.failed_actions > 0
              ? `${audit.failed_actions} failed — check the log`
              : 'no failures'
            : 'waiting for data'}
        </p>
      </div>
      </Expandable>
    </div>
  );
}

// ── Activity feed — one panel, hairline-separated rows ───────────────

function RecentActivity() {
  const { data } = useRecentAudit(8);
  const entries = (data?.entries ?? []).slice(0, 8);

  if (!entries.length) {
    return (
      <div className="plat-panel text-sm" style={{ color: 'var(--text-4)' }}>
        Nothing yet — actions your agent takes will appear here.
      </div>
    );
  }

  return (
    <div className="plat-list">
      {entries.map((e) => (
        <div key={e.id} className="plat-row">
          <span className="plat-row-icon">
            {e.approved ? (
              <Check className="h-4 w-4" strokeWidth={2.25} />
            ) : (
              <CircleAlert className="h-4 w-4" style={{ color: 'var(--bad-fg)' }} />
            )}
          </span>
          <span className="min-w-0 truncate">
            <span className="plat-row-title">{e.tool ?? e.action}</span>
            {e.input_summary && (
              <span className="text-sm" style={{ color: 'var(--text-4)' }}>
                {' '}— {e.input_summary}
              </span>
            )}
          </span>
          <span className="plat-row-meta">
            {e.cost_usd != null && e.cost_usd > 0 && (
              <span className="mr-3 font-mono text-xs">{fmtUsd(e.cost_usd)}</span>
            )}
            {timeAgo(e.timestamp)}
          </span>
        </div>
      ))}
      {data && (
        <p
          className="px-5 py-2.5 text-right text-[11px]"
          style={{ color: 'var(--text-5)', background: 'var(--sand)' }}
        >
          {data.total} actions all-time
        </p>
      )}
    </div>
  );
}

// ── Spend trend + model breakdown ────────────────────────────────────

function SpendTrendCard() {
  const { data: history } = useCostHistory(14);
  const { data: models } = useCostsByModel(7);
  const detail = useDetail('Spend', 'Where the money goes — daily trend, models, tools', <SpendDetail />);

  const max = useMemo(
    () => Math.max(...(history?.data.map((d) => d.total_usd) ?? [0]), 0.000001),
    [history],
  );
  const maxModel = Math.max(...(models?.models.map((m) => m.total_usd) ?? [0]), 0.000001);

  return (
    <div className="plat-panel">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">Spend — last 14 days</p>
        <span className="ml-auto text-[11px]" style={{ color: 'var(--text-5)' }}>
          {history
            ? `${fmtUsd(history.totals.total_usd)} total · ${history.totals.total_requests} requests`
            : ''}
        </span>
        {detail.trigger}
      </div>

      {!history?.data.length ? (
        <div className="py-4 text-sm" style={{ color: 'var(--text-4)' }}>No spend recorded yet.</div>
      ) : (
        <div className="flex h-24 items-end gap-1.5">
          {history.data.map((d) => (
            <div
              key={d.date}
              className="flex-1 rounded-t-md transition-colors"
              style={{ height: `${Math.max(4, (d.total_usd / max) * 100)}%`, background: 'var(--brand-200)' }}
              onMouseEnter={(ev) => ((ev.currentTarget as HTMLDivElement).style.background = 'var(--brand)')}
              onMouseLeave={(ev) => ((ev.currentTarget as HTMLDivElement).style.background = 'var(--brand-200)')}
              title={`${d.date} · ${fmtUsd(d.total_usd)} · ${d.request_count} requests`}
            />
          ))}
        </div>
      )}

      {!!models?.models.length && (
        <div className="mt-5 space-y-2 border-t pt-4" style={{ borderColor: 'var(--line-soft)' }}>
          <p className="plat-eyebrow">Which models cost what (7d)</p>
          {models.models.slice(0, 4).map((m) => (
            <div key={m.model} className="flex items-center gap-3 text-xs">
              <span className="w-44 truncate font-mono" style={{ color: 'var(--text-2)' }}>{m.model}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--sand-deep)' }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(m.total_usd / maxModel) * 100}%`, background: 'var(--ink)' }}
                />
              </div>
              <span className="w-16 text-right" style={{ color: 'var(--text-3)' }}>{fmtUsd(m.total_usd)}</span>
            </div>
          ))}
        </div>
      )}
      {detail.dialog}
    </div>
  );
}

// ── Right rail: agent, quick actions, automation ─────────────────────

function AgentCard() {
  const { st, unreachable } = liveAgentStatus(useAgentStatus());
  const detail = useDetail('Agent', 'Runtime, channels and what the agent has been doing', <AgentDetail />);
  return (
    <div className="plat-panel">
      <div className="mb-3 flex items-center gap-2">
        <Cpu className="h-4 w-4" style={{ color: 'var(--text-5)' }} />
        <p className="text-sm font-semibold">Agent</p>
        <span className="ml-auto flex items-center gap-3">
          {st && <span className="font-mono text-[11px]" style={{ color: 'var(--text-5)' }}>v{st.version}</span>}
          {detail.trigger}
        </span>
      </div>
      {unreachable ? (
        <span className="plat-pill plat-pill-warn" title="The last status check failed — retrying">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--warn-fg)' }} />
          Not reachable
        </span>
      ) : (
        <span className={cn('plat-pill', !st ? 'plat-pill-mute' : st.agent_running ? 'plat-pill-ok' : 'plat-pill-warn')}>
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: !st ? 'var(--text-5)' : st.agent_running ? 'var(--ok-fg)' : 'var(--warn-fg)' }}
          />
          {!st ? 'waiting for data' : st.agent_running ? 'Running' : 'Stopped'}
        </span>
      )}
      {st && (
        <div className="mt-4 space-y-1.5 border-t pt-3" style={{ borderColor: 'var(--line-soft)' }}>
          <p className="plat-eyebrow mb-2">Channels</p>
          {Object.entries(st.channels).map(([name, on]) => (
            <div key={name} className="flex items-center justify-between text-xs">
              <span className="capitalize" style={{ color: 'var(--text-2)' }}>{name}</span>
              <span
                className="flex items-center gap-1.5 font-medium"
                style={{ color: on ? 'var(--ok-fg)' : 'var(--text-5)' }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: on ? 'var(--ok-fg)' : 'var(--sand-deep)' }}
                />
                {on ? 'on' : 'off'}
              </span>
            </div>
          ))}
        </div>
      )}
      {detail.dialog}
    </div>
  );
}

/** Squircle-icon list rows, straight from the reference nav screen. */
function QuickActions() {
  const navigate = useNavigate();
  const actions = [
    { label: 'Open Chat', sub: 'Talk to your agents', icon: MessageSquare, onClick: () => navigate('/chat') },
    { label: 'Voice Calls', sub: 'Start or schedule calls', icon: Phone, onClick: () => navigate('/telephony') },
  ];
  return (
    <div className="plat-panel !px-4">
      <p className="plat-eyebrow mb-2 px-2">Quick actions</p>
      <div className="space-y-1">
        {actions.map(({ label, sub, icon: Icon, onClick }) => (
          <button key={label} type="button" onClick={onClick} className="plat-item">
            <span className="plat-item-icon !h-11 !w-11 !rounded-[10px]">
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </span>
            <span className="min-w-0">
              <span className="plat-item-title block text-[14px]">{label}</span>
              <span className="plat-item-sub block text-xs">{sub}</span>
            </span>
            <ArrowUpRight className="ml-auto h-4 w-4 shrink-0" style={{ color: 'var(--text-5)' }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function AutomationCard() {
  const { data: schedules } = useSchedules();
  const { data: skills } = useSkills();
  const next = schedules?.tasks.find((t) => t.enabled && t.next_run_at);
  const detail = useDetail('Automation', 'Every scheduled task and installed skill', <AutomationDetail />);
  return (
    <div className="plat-panel">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock className="h-4 w-4" style={{ color: 'var(--text-5)' }} />
        <p className="text-sm font-semibold">Automation</p>
        <span className="ml-auto">{detail.trigger}</span>
      </div>
      <div className="flex items-baseline justify-between text-sm">
        <span style={{ color: 'var(--text-3)' }}>Scheduled tasks</span>
        <span className="font-semibold">{schedules?.future_count ?? '—'}</span>
      </div>
      {next && (
        <div className="mt-3 rounded-[10px] px-3.5 py-2.5 text-xs" style={{ background: 'var(--sand)' }}>
          <p className="font-semibold">{next.name}</p>
          <p className="mt-0.5" style={{ color: 'var(--text-4)' }}>
            next: {next.next_run_at ? new Date(next.next_run_at).toLocaleString() : '—'} · {next.channel}
          </p>
        </div>
      )}
      <div className="mt-3 flex items-baseline justify-between border-t pt-3 text-sm" style={{ borderColor: 'var(--line-soft)' }}>
        <span className="flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
          <Sparkles className="h-3.5 w-3.5" style={{ color: 'var(--text-5)' }} />
          Skills installed
        </span>
        <span className="font-semibold">{skills?.skills.length ?? '—'}</span>
      </div>
      {!!skills?.skills.length && (
        <div className="mt-2 flex flex-wrap gap-1">
          {skills.skills.slice(0, 6).map((s) => (
            <span
              key={s.dir}
              title={s.description}
              className="rounded-full px-2.5 py-1 font-mono text-[10px]"
              style={{ background: 'var(--sand)', color: 'var(--text-3)' }}
            >
              {s.name}
            </span>
          ))}
          {skills.skills.length > 6 && (
            <span className="px-1 text-[10px]" style={{ color: 'var(--text-5)' }}>
              +{skills.skills.length - 6} more
            </span>
          )}
        </div>
      )}
      {detail.dialog}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

const Dashboard = () => {
  const connected = isConnected();
  const activityDetail = useDetail(
    'Activity',
    'The full audit log, with volume and failure rate over time',
    <ActivityDetail />,
  );

  return (
    <QueryClientProvider client={queryClient}>
      <div className="plat flex min-h-screen flex-col">
        <SidebarProvider>
          <div className="flex w-full flex-1">
            <AppSidebar />
            <SidebarInset className="flex flex-1 flex-col bg-transparent">
              <MobileMenuBar />
              <main className="mx-auto w-full max-w-6xl flex-1 p-6 lg:p-8">
                {/* Page header — mono breadcrumb, like the reference */}
                <div className="mb-8 flex items-center justify-between">
                  <div>
                    <p className="plat-crumb">3days.dashboard</p>
                    <p className="mt-1 text-sm" style={{ color: 'var(--text-4)' }}>
                      What your AI workforce is doing, at a glance
                    </p>
                  </div>
                </div>

                {!connected && <ConnectStrip />}

                {/* 1 · Today */}
                <section className="mb-10">
                  <SectionHeader label="Today" hint={new Date().toLocaleDateString()} />
                  <TodayRow />
                </section>

                {/* 2 + 3 · Activity/Spend on the left, setup on the right */}
                <div className="mb-10 grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
                  <div className="space-y-8 lg:col-span-2">
                    <section>
                      <SectionHeader label="Activity" action={activityDetail.trigger} />
                      <RecentActivity />
                      {activityDetail.dialog}
                    </section>
                    <section>
                      <SectionHeader label="Spend" />
                      <SpendTrendCard />
                    </section>
                  </div>
                  <div className="space-y-4">
                    <section>
                      <SectionHeader label="Your agent" />
                      <div className="space-y-4">
                        <AgentCard />
                        <QuickActions />
                        <AutomationCard />
                      </div>
                    </section>
                  </div>
                </div>

                {/* 4 · The board: dashboards the person picks and arranges */}
                <DashboardBoard />

              </main>
            </SidebarInset>
          </div>
        </SidebarProvider>
      </div>
    </QueryClientProvider>
  );
};

export default Dashboard;
