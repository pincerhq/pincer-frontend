/**
 * The rail's "Pending Approval" screen.
 *
 * v3 turned this real. Until Sprint 11 there was no way to park an approval
 * gate — decisions only existed live, inside a call — so this screen was a
 * badged demo queue. Now `user`-mode gates are held server-side and listed by
 * `/api/voice/approvals/pending`, streamed over SSE, so the queue below is the
 * actual set of callers waiting on an answer.
 *
 * The same cards also float over every other page (`VoiceApprovalHost`): this
 * screen is where you go to watch for them, not the only place they appear.
 */
import { MessageSquare, Radio, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  useActiveCalls,
  useDecideApproval,
  usePendingApprovals,
  useVoiceConnected,
  type ApprovalState,
} from '@/lib/api/voice';
import { ApprovalCard } from '@/components/voice/ApprovalCard';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export default function PendingApprovalView() {
  const navigate = useNavigate();
  const connected = useVoiceConnected();
  const { data: activeCalls } = useActiveCalls();
  const { approvals, streaming, isLoading } = usePendingApprovals();
  const decide = useDecideApproval();

  const [decided, setDecided] = useState<Record<string, ApprovalState>>({});
  const [busy, setBusy] = useState<Record<string, 'approve' | 'deny'>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onDecide = (id: string, decision: 'approve' | 'deny') => {
    setBusy((b) => ({ ...b, [id]: decision }));
    setErrors(({ [id]: _drop, ...rest }) => rest);
    decide.mutate(
      { id, decision },
      {
        onSuccess: (out) => setDecided((d) => ({ ...d, [id]: out.state })),
        onError: (err) => {
          if (err.status === 409) {
            setDecided((d) => ({ ...d, [id]: err.state ?? 'expired' }));
            return;
          }
          setErrors((e) => ({ ...e, [id]: err.message || 'Could not send the decision' }));
        },
        onSettled: () => setBusy(({ [id]: _drop, ...rest }) => rest),
      },
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-[var(--line-soft)] px-6 pb-4 pt-5">
        <p className="plat-crumb" style={{ color: 'var(--text-4)' }}>3days.telephony</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-[26px] text-[var(--ink)]">Pending Approval</h1>
          {connected && (
            <span
              title={
                streaming
                  ? 'Live: approvals arrive over the event stream'
                  : 'Stream down — falling back to polling every 3s'
              }
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
                streaming
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700',
              )}
            >
              {streaming ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {streaming ? 'live' : 'polling'}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-[var(--text-4)]">
          Tool calls the agent paused mid-conversation, waiting on you — the caller is on hold.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {!connected ? (
          <p className="text-sm text-[var(--text-4)]">
            Not connected to a Pincer backend — connect on the Voice page to receive approvals.
          </p>
        ) : (
          <div className="space-y-4">
            {isLoading ? (
              <p className="text-sm text-[var(--text-4)]">Loading…</p>
            ) : !approvals.length ? (
              <div className="rounded-[14px] border border-[var(--line-soft)] bg-[var(--paper)] py-10 text-center">
                <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-green-500" />
                <p className="text-sm text-[var(--text-3)]">Nothing waiting on you.</p>
                <p className="mx-auto mt-1 max-w-md text-xs text-[var(--text-3)]">
                  When the agent hits a tool that needs your say-so during a call, the request
                  appears here — and as a card over whatever page you are on.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigate('/telephony/calls/live')}
                    className="flex h-8 items-center gap-1.5 rounded-full bg-[var(--brand)] px-3.5 text-xs font-medium text-[var(--on-brand)] transition-colors hover:bg-[var(--brand-hover)]"
                  >
                    <Radio className="h-3.5 w-3.5" />
                    Watch live calls
                    {!!activeCalls?.length && (
                      <span className="rounded-full bg-[color:color-mix(in_srgb,var(--on-brand)_70%,transparent)] px-1.5 text-[10px] font-semibold text-[var(--ink)]">
                        {activeCalls.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/chat')}
                    className="flex h-8 items-center gap-1.5 rounded-full bg-[var(--sand)] px-3.5 text-xs font-medium text-[var(--text-2)] transition-colors hover:bg-[var(--sand-deep)]"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Open Chat (web approvals appear there)
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-4">
                {approvals.map((a) => (
                  <ApprovalCard
                    key={a.id}
                    approval={a}
                    state={decided[a.id] ?? 'pending'}
                    deciding={busy[a.id] ?? null}
                    error={errors[a.id] ?? null}
                    muted
                    onToggleMute={() => {}}
                    onDecide={(decision) => onDecide(a.id, decision)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
