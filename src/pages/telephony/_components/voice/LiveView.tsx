/**
 * The rail's "Live" screen: every call in progress, on REAL data
 * (/api/voice/active, polled every 2s). Each card opens LiveCallModal with
 * the live transcript and action feed. What the backend cannot serve —
 * listening to audio in the browser — stays visibly badged.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Maximize2,
  PhoneCall,
  PhoneOutgoing,
  Plug,
  Radio,
} from 'lucide-react';
import { useActiveCalls, useVoiceConnected, useVoiceStatus, type ActiveCall } from '@/lib/api/voice';
import LiveCallModal from '@/pages/telephony/_components/voice/LiveCallModal';
import ListenIn from '@/components/voice/listen/ListenIn';
import EndCallButton from '@/components/voice/EndCallButton';
import StartCallModal from '@/pages/telephony/_components/voice/StartCallModal';
import { cn } from '@/lib/utils';

function fmtDuration(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function ConnectPrompt() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-[14px] border border-[var(--line)] bg-[var(--paper)] p-8 text-center">
      <Plug className="mx-auto mb-3 h-8 w-8 text-[var(--text-5)]" />
      <h2 className="text-sm font-semibold text-[var(--ink)]">Not connected to a Pincer backend</h2>
      <p className="mt-2 text-xs leading-relaxed text-[var(--text-5)]">
        Live calls come straight from your Pincer server. Connect this browser with the shared
        bearer token and calls in progress will appear here as they happen.
      </p>
      <Link
        to="/login"
        className="mt-4 inline-block rounded-full bg-[var(--brand)] px-4 py-2 text-xs font-semibold text-[var(--on-brand)] transition-colors hover:bg-[var(--brand-hover)]"
      >
        Connect (Login → Token)
      </Link>
    </div>
  );
}

export default function LiveView() {
  const connected = useVoiceConnected();
  const { data: polled, isLoading, isError } = useActiveCalls();
  // After a failed poll `data` is the last list; it must not pass for live calls.
  const calls = isError ? undefined : polled;
  const { data: status } = useVoiceStatus();
  const [selected, setSelected] = useState<ActiveCall | null>(null);
  // The open call as of the latest poll; once the list no longer has it, it has ended.
  const selectedNow = selected ? calls?.find((c) => c.call_sid === selected.call_sid) : undefined;
  const selectedEnded = !!selected && !!calls && !selectedNow;
  const [startOpen, setStartOpen] = useState(false);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-soft)] px-6 pt-5 pb-4">
        <div>
          <p className="plat-crumb" style={{ color: 'var(--text-4)' }}>3days.telephony</p>
          <h1 className="mt-1 flex items-center gap-2.5 text-[26px] text-[var(--ink)]">
            Live
            {!!calls?.length && (
              <span className="flex items-center gap-1.5 rounded-full bg-[var(--ok-fill)] px-2.5 py-1 text-xs font-semibold text-[var(--on-ok-fill)]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--on-ok-fill)]" />
                {calls.length} in progress
              </span>
            )}
          </h1>
          <p className="mt-1 text-xs text-[var(--text-4)]">
            Calls happening right now · updates every 2 seconds
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-4)]">
              {status.engine} · {status.language}
            </span>
          )}
          {connected && (
            <button
              type="button"
              onClick={() => setStartOpen(true)}
              className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--brand)] px-3.5 text-xs font-medium text-[var(--on-brand)] transition-colors hover:bg-[var(--brand-hover)]"
            >
              <PhoneOutgoing className="h-3.5 w-3.5" />
              New call
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {!connected ? (
          <ConnectPrompt />
        ) : isLoading ? (
          <div className="py-12 text-center text-sm text-[var(--text-5)]">Loading…</div>
        ) : isError ? (
          <div className="mx-auto mt-16 max-w-md text-center">
            <Plug className="mx-auto mb-3 h-8 w-8 text-[var(--text-5)]" />
            <h2 className="text-sm font-semibold text-[var(--ink)]">Pincer server not reachable</h2>
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-5)]">
              Calls in progress cannot be loaded right now. This screen retries every 2 seconds.
            </p>
          </div>
        ) : !calls?.length ? (
          <div className="mx-auto mt-16 max-w-md text-center">
            <Radio className="mx-auto mb-3 h-8 w-8 text-[var(--text-5)]" />
            <h2 className="text-sm font-semibold text-[var(--ink)]">No calls in progress</h2>
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-5)]">
              This screen fills up the moment a call starts — incoming calls answered by the
              agent, or outbound calls you start from the Voice page.
            </p>
            <button
              type="button"
              onClick={() => setStartOpen(true)}
              className="mx-auto mt-4 flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-2 text-xs font-medium text-[var(--on-brand)] hover:bg-[var(--brand-hover)]"
            >
              <PhoneOutgoing className="h-3.5 w-3.5" />
              Start a call
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-[14px] border border-[var(--line-soft)] bg-[var(--paper)]">
              {calls.map((c) => (
                <div
                  key={c.call_sid}
                  className="border-b border-[var(--line-soft)] px-5 py-4 last:border-b-0"
                >
                <button
                  type="button"
                  onClick={() => setSelected(c)}
                  className="group -mx-2 w-[calc(100%+1rem)] rounded-[10px] px-2 py-1 text-left transition-colors hover:bg-[color:color-mix(in_srgb,var(--ink)_2%,transparent)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[12px] bg-green-50">
                        <PhoneCall className="h-5 w-5 text-green-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-[var(--ink)]">
                          {c.direction === 'outbound' ? (
                            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-5)]" />
                          ) : (
                            <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-[var(--text-5)]" />
                          )}
                          {c.target_name || c.target_number || c.caller_number}
                        </p>
                        <p
                          className="truncate text-xs text-[var(--text-3)]"
                          title={c.briefing_task_preview || c.purpose}
                        >
                          {c.briefing_task_preview || c.purpose}
                        </p>
                      </div>
                    </div>
                    <Maximize2 className="h-4 w-4 shrink-0 text-[var(--text-5)] transition-colors group-hover:text-[var(--text-4)]" />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-green-700">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                      live · {fmtDuration(c.duration_seconds)}
                    </span>
                    <span className="text-[var(--text-3)]">{c.engine}</span>
                    <span className={cn('font-mono text-[var(--text-3)]')}>
                      {c.direction === 'outbound' ? c.target_number : c.caller_number}
                    </span>
                  </div>
                </button>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <ListenIn call={c} />
                    <EndCallButton callSid={c.call_sid} />
                  </div>
                </div>
              ))}
            </div>

          </div>
        )}
      </div>

      {selected && (
        <LiveCallModal call={selectedNow ?? selected} ended={selectedEnded} onClose={() => setSelected(null)} />
      )}
      {startOpen && <StartCallModal onClose={() => setStartOpen(false)} />}
    </div>
  );
}
