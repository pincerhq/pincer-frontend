/**
 * Settings → Voice: the resolved tool policy (S11 §3), read-only.
 *
 * The policy is what stops an agent spending money mid-call, so in v1 it lives
 * in server config where it is reviewable. The panel says that out loud rather
 * than showing disabled inputs that imply a future toggle.
 *
 * It reads the same resolved config as `pincer doctor`; if the two ever
 * disagree, one of them is wrong about what the agent may do.
 */
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import { useVoicePolicy, type ApprovalMode } from '@/lib/api/voice';
import { CHIP_TONE_CLASS, modeMeta, tierMeta } from '@/pages/telephony/_lib/voiceMeta';
import { cn } from '@/lib/utils';

/** One sentence per mode, in terms of the caller rather than the config. */
const MODE_SENTENCE: Record<string, string> = {
  auto: 'Tools run without asking anyone. Only read-only tools reach this mode.',
  verbal: 'The agent asks the caller out loud and acts on a spoken yes.',
  user: 'The agent puts the caller on hold and asks you here before acting.',
  off: 'No approvals are requested — the agent acts on its own, including writes.',
};

const TIER_ORDER = ['R', 'W', 'X'] as const;

const TIER_HEADING: Record<string, string> = {
  R: 'Read — cannot change anything',
  W: 'Write — changes data outside the call',
  X: 'Dangerous — money, deletion, irreversible',
};

function ModeBadge({ mode }: { mode: ApprovalMode | string }) {
  const meta = modeMeta(mode);
  if (!meta) return null;
  return (
    <span
      title={meta.title}
      className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', CHIP_TONE_CLASS[meta.tone])}
    >
      {meta.label}
    </span>
  );
}

export default function PolicyPanel() {
  const { data, isLoading, isError } = useVoicePolicy();

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-xs text-[var(--text-3)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading tool policy…
      </p>
    );
  }
  if (isError || !data) {
    return (
      <p className="text-xs text-[var(--text-3)]">
        This backend does not expose <span className="font-mono">/api/voice/policy</span> yet — check{' '}
        <span className="font-mono">pincer doctor</span> for the active policy.
      </p>
    );
  }

  const globalMode = String(data.global_mode ?? '').toLowerCase();
  const byTier = TIER_ORDER.map((tier) => ({
    tier,
    tools: (data.tiers ?? []).filter((t) => String(t.tier).toUpperCase() === tier),
  })).filter((g) => g.tools.length);

  return (
    <div className="space-y-4" data-testid="voice-policy-panel">
      {/* The one state that is a warning, phrased like the doctor's */}
      {globalMode === 'off' && (
        <div
          data-testid="policy-off-banner"
          className="flex items-start gap-2 rounded-[10px] border border-amber-300 bg-amber-50 px-4 py-3"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div>
            <p className="text-sm font-semibold text-amber-900">
              Autonomous writes during calls are enabled
            </p>
            <p className="mt-0.5 text-xs text-amber-800">
              With the global mode set to <span className="font-mono">off</span>, the agent executes
              tools mid-call without asking the caller or you. Every such action is disclosed in the
              call detail and in the call report.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-[14px] border border-[var(--line-soft)] bg-[var(--paper)] p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[var(--ink)]">Approval mode</h2>
          <ModeBadge mode={globalMode} />
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-[var(--text-5)]">
            <Info className="h-3.5 w-3.5" />
            configured via server settings
          </span>
        </div>
        <p className="mt-2 text-xs text-[var(--text-3)]">
          {MODE_SENTENCE[globalMode] ?? `Unrecognised mode "${data.global_mode}" — check the server config.`}
        </p>

        {data.write_budget && (
          <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-[var(--line-soft)] pt-3 text-xs">
            <span className="text-[var(--text-5)]">Write budget</span>
            <span className="font-medium text-[var(--text-1)]">
              {data.write_budget.limit == null ? 'unlimited' : `${data.write_budget.limit} writes`}
              {data.write_budget.window ? ` ${data.write_budget.window}` : ''}
            </span>
            {data.write_budget.used != null && (
              <span className="text-[var(--text-4)]">{data.write_budget.used} used</span>
            )}
          </div>
        )}
      </div>

      <div className="rounded-[14px] border border-[var(--line-soft)] bg-[var(--paper)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--ink)]">Per-tool overrides</h2>
        {!data.overrides?.length ? (
          <p className="text-xs text-[var(--text-5)]">
            No overrides — every tool uses the global mode above.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-[var(--text-5)]">
                <th className="pb-2 font-medium">Tool</th>
                <th className="pb-2 font-medium">Mode</th>
                <th className="pb-2 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              {data.overrides.map((o) => (
                <tr key={o.tool} className="border-t border-[var(--line-soft)]">
                  <td className="py-2 pr-3 font-mono text-[var(--text-1)]">{o.tool}</td>
                  <td className="py-2 pr-3">
                    <ModeBadge mode={o.mode} />
                  </td>
                  <td className="py-2 text-[var(--text-4)]">{o.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-[14px] border border-[var(--line-soft)] bg-[var(--paper)] p-5">
        <h2 className="mb-1 text-sm font-semibold text-[var(--ink)]">Tools by tier</h2>
        <p className="mb-3 text-[11px] text-[var(--text-5)]">
          The tier decides which approvals a tool needs before the overrides apply.
        </p>
        {!byTier.length ? (
          <p className="text-xs text-[var(--text-5)]">The backend listed no tools.</p>
        ) : (
          <div className="space-y-4">
            {byTier.map(({ tier, tools }) => (
              <div key={tier}>
                <p className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-[var(--text-3)]">
                  <span
                    className={cn(
                      'rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-semibold',
                      tierMeta(tier)?.cls,
                    )}
                  >
                    {tier}
                  </span>
                  {TIER_HEADING[tier]}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {tools.map((t) => (
                    <span
                      key={t.tool}
                      className="rounded-full bg-[var(--sand)] px-2.5 py-1 font-mono text-[10px] text-[var(--text-2)]"
                    >
                      {t.tool}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
