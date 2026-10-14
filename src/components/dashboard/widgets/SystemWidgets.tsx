/**
 * The agent's own surface area: what it is plugged into, and what it can do.
 * `/api/integrations` and `/api/skills` both answer without any extra backend
 * work, which is why they make good starter widgets.
 */
import { useMemo } from 'react';
import { useIntegrations } from '@/lib/api/integrations';
import { useSkills } from '@/lib/api/dashboard';
import { RankBars } from '../DashCharts';
import { fmtNum } from '../dashFormat';
import { WidgetEmpty, WidgetPlot, WidgetStats } from './widgetKit';

export function IntegrationsWidget() {
  const { data } = useIntegrations();

  const entries = useMemo(() => data?.integrations ?? [], [data]);
  const active = entries.filter((e) => e.status === 'active').length;
  const needsApproval = entries.filter((e) => e.approval_required).length;

  const bySource = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const e of entries) acc[e.source || 'other'] = (acc[e.source || 'other'] ?? 0) + 1;
    return Object.entries(acc).sort((a, b) => b[1] - a[1]);
  }, [entries]);

  return (
    <>
      <WidgetStats
        items={[
          { label: 'Connected', value: fmtNum(active), sub: `of ${fmtNum(entries.length)} available` },
          { label: 'Ask first', value: fmtNum(needsApproval), sub: 'need your approval to run' },
          { label: 'Kinds', value: fmtNum(bySource.length), sub: bySource.map(([s]) => s).join(', ') || undefined },
        ]}
      />
      <WidgetPlot title="Where they come from" hint="tools per source">
        {bySource.length ? (
          <RankBars
            rows={bySource.map(([label, value]) => ({ label, value }))}
            format={(n) => fmtNum(Math.round(n))}
            color="var(--brand)"
          />
        ) : (
          <WidgetEmpty>Nothing connected yet.</WidgetEmpty>
        )}
      </WidgetPlot>
    </>
  );
}

export function SkillsWidget() {
  const { data } = useSkills();

  const skills = data?.skills ?? [];
  const active = skills.filter((s) => s.status === 'active').length;
  const sources = new Set(skills.map((s) => s.source)).size;

  return (
    <>
      <WidgetStats
        items={[
          { label: 'Skills', value: fmtNum(skills.length), sub: `${fmtNum(active)} active` },
          { label: 'Sources', value: fmtNum(sources), sub: 'packs installed' },
        ]}
      />
      {skills.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {skills.slice(0, 10).map((s) => (
            <span
              key={s.name}
              className="rounded-full px-2.5 py-1 text-[11px]"
              style={{ background: 'var(--sand)', color: 'var(--text-3)' }}
              title={s.description}
            >
              {s.name}
            </span>
          ))}
          {skills.length > 10 && (
            <span className="px-1 text-[10px]" style={{ color: 'var(--text-5)' }}>
              +{skills.length - 10} more
            </span>
          )}
        </div>
      ) : (
        <WidgetEmpty>No skills installed yet.</WidgetEmpty>
      )}
    </>
  );
}
