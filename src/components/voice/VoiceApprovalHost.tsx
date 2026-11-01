/**
 * Live approval cards, over whatever page the owner is on.
 *
 * Global rather than part of the Voice page: the approval fires mid-call and
 * the owner is usually somewhere else, so a surface that only existed on
 * /telephony would let the caller wait out the 25s timeout.
 *
 * Sound is on by default here, against the app's usual no-sound rule, for the
 * same reason. It is muteable from the card and the preference persists.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import {
  onApprovalTerminal,
  useLiveCalls,
  usePendingApprovals,
  useDecideApproval,
  isConnected,
  type ApprovalState,
  type VoiceApproval,
} from '@/lib/api/voice';
import { ApprovalCard, msRemaining } from './ApprovalCard';
import { useClaimedCalls } from './approvalFocus';

/** How long a decided/expired card stays on screen before dismissing itself. */
const TERMINAL_LINGER_MS = 3_000;

const MUTE_KEY = 'pincer.voice.approvalSound';

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === 'off';
  } catch {
    return false;
  }
}

/** Synthesised rather than an asset: no fetch at the moment latency matters. */
function playPing() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.42);
    gain.connect(ctx.destination);

    [880, 1_320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(ctx.currentTime + i * 0.16);
      osc.stop(ctx.currentTime + i * 0.16 + 0.14);
    });
    setTimeout(() => void ctx.close().catch(() => {}), 900);
  } catch {
    /* autoplay policy or no audio device; the card is still on screen */
  }
}

interface CardState {
  approval: VoiceApproval;
  state: ApprovalState;
  deciding: 'approve' | 'deny' | null;
  error: string | null;
}

/** The live call behind an approval knows its thread; the card just shows it. */
function useThreadSubjectFor() {
  const { calls: active } = useLiveCalls();
  return (callSid: string) =>
    (active ?? []).find((c) => c.call_sid === callSid)?.thread_subject ?? null;
}

function ApprovalStack() {
  const { approvals: allApprovals } = usePendingApprovals();
  // A call with its live screen open decides its own approvals there; a
  // floating copy would be the same decision twice, on top of the row.
  const claimed = useClaimedCalls();
  const approvals = useMemo(
    () => allApprovals.filter((a) => !claimed.includes(a.call_sid)),
    [allApprovals, claimed],
  );
  const decide = useDecideApproval();
  const [cards, setCards] = useState<CardState[]>([]);
  const [muted, setMuted] = useState(readMuted);
  const seen = useRef<Set<string>>(new Set());
  const timers = useRef<Map<string, number>>(new Map());

  const dismissLater = useCallback((id: string) => {
    const existing = timers.current.get(id);
    if (existing) window.clearTimeout(existing);
    const t = window.setTimeout(() => {
      setCards((prev) => prev.filter((c) => c.approval.id !== id));
      timers.current.delete(id);
    }, TERMINAL_LINGER_MS);
    timers.current.set(id, t);
  }, []);

  const settle = useCallback(
    (id: string, state: ApprovalState, error: string | null = null) => {
      setCards((prev) =>
        prev.map((c) => (c.approval.id === id ? { ...c, state, deciding: null, error } : c)),
      );
      dismissLater(id);
    },
    [dismissLater],
  );

  // New approvals in, resolved ones out.
  useEffect(() => {
    const live = approvals.filter((a) => msRemaining(a.expires_at) > 0);

    setCards((prev) => {
      const byId = new Map(prev.map((c) => [c.approval.id, c]));
      let next = prev;

      for (const a of live) {
        const existing = byId.get(a.id);
        if (!existing) {
          next = [...next, { approval: a, state: 'pending' as ApprovalState, deciding: null, error: null }];
        } else if (existing.state === 'pending') {
          // Refresh the payload (summary/expiry can be updated by the server).
          next = next.map((c) => (c.approval.id === a.id ? { ...c, approval: a } : c));
        }
      }

      // Gone from the list, no terminal event: resolved elsewhere (Telegram).
      // Drop it rather than invent a verdict.
      const liveIds = new Set(live.map((a) => a.id));
      return next.filter(
        (c) => c.state !== 'pending' || c.deciding || liveIds.has(c.approval.id),
      );
    });

    for (const a of live) {
      if (seen.current.has(a.id)) continue;
      seen.current.add(a.id);
      if (!readMuted()) playPing();
    }
  }, [approvals]);

  // Terminal events from the stream: decided elsewhere, or expired server-side.
  useEffect(() => onApprovalTerminal((id, state) => settle(id, state)), [settle]);

  // Local expiry: the ring hitting zero flips the card too.
  useEffect(() => {
    const pending = cards.filter((c) => c.state === 'pending' && !c.deciding);
    if (!pending.length) return;
    const t = window.setInterval(() => {
      for (const c of pending) {
        if (msRemaining(c.approval.expires_at) <= 0) settle(c.approval.id, 'expired');
      }
    }, 500);
    return () => window.clearInterval(t);
  }, [cards, settle]);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => window.clearTimeout(t));
  }, []);

  const onDecide = (id: string, decision: 'approve' | 'deny') => {
    setCards((prev) =>
      prev.map((c) => (c.approval.id === id ? { ...c, deciding: decision, error: null } : c)),
    );
    decide.mutate(
      { id, decision },
      {
        onSuccess: (out) => settle(id, out.state),
        onError: (err) => {
          // 409 means it reached a terminal state elsewhere. Not an error to
          // the owner: it is the answer.
          if (err.status === 409) {
            settle(id, err.state ?? 'expired');
            return;
          }
          setCards((prev) =>
            prev.map((c) =>
              c.approval.id === id
                ? { ...c, deciding: null, error: err.message || 'Could not send the decision' }
                : c,
            ),
          );
        },
      },
    );
  };

  const threadSubjectFor = useThreadSubjectFor();

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    try {
      localStorage.setItem(MUTE_KEY, next ? 'off' : 'on');
    } catch {
      /* private mode: the preference just does not persist */
    }
  };

  if (!cards.length) return null;

  return (
    <div className="plat pointer-events-none fixed right-4 top-4 z-[80] flex flex-col gap-3">
      {cards.map((c) => (
        <div key={c.approval.id} className="pointer-events-auto">
          <ApprovalCard
            approval={c.approval}
            threadSubject={threadSubjectFor(c.approval.call_sid)}
            state={c.state}
            deciding={c.deciding}
            error={c.error}
            muted={muted}
            onToggleMute={toggleMute}
            onDecide={(decision) => onDecide(c.approval.id, decision)}
          />
        </div>
      ))}
    </div>
  );
}

export default function VoiceApprovalHost() {
  // No token, no stream, nothing to approve, and no polling either.
  if (!isConnected()) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <ApprovalStack />
    </QueryClientProvider>
  );
}
