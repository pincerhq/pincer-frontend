/**
 * Listening to a call as it happens (S15 §4).
 *
 * Listen-only by construction: the server subscribes the browser to a
 * receive-only media fork, so there is no way to speak into the call from
 * here — no whisper, no barge-in, no record button, and no playback of calls
 * that already ended (that is what the transcript is for).
 *
 * Audio starts from the click and only from the click: the button is the user
 * gesture browsers require, and nothing here ever begins playing on its own.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Headphones, Loader2, MicOff, Volume2, VolumeX, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ActiveCall } from '@/lib/api/voice';
import { ListenAudio } from './audioSink';
import {
  ListenClient,
  type ListenEndReason,
  type ListenState,
  type ListenTrack,
} from './listenClient';

const T = {
  listen: { en: 'Listen', de: 'Mithören' },
  stop: { en: 'Stop listening', de: 'Mithören beenden' },
  connecting: { en: 'Connecting…', de: 'Verbinde…' },
  live: { en: 'Listening live', de: 'Live mithören' },
  reconnecting: { en: 'Reconnecting…', de: 'Neu verbinden…' },
  callEnded: { en: 'Call ended', de: 'Anruf beendet' },
  capacity: { en: 'Listener limit reached', de: 'Zuhörer-Limit erreicht' },
  failed: { en: 'Lost the audio stream', de: 'Audio-Verbindung verloren' },
  unsupported: {
    en: 'This browser cannot play the live audio (AudioWorklet unavailable).',
    de: 'Dieser Browser kann das Live-Audio nicht abspielen (kein AudioWorklet).',
  },
  unavailable: {
    en: 'Listening is not available on this call',
    de: 'Mithören ist bei diesem Anruf nicht verfügbar',
  },
  caller: { en: 'Caller', de: 'Anrufer' },
  agent: { en: 'Agent', de: 'Agent' },
  listeners: { en: 'listening', de: 'hören mit' },
  announced: {
    en: 'Both sides were told this call may be monitored.',
    de: 'Beide Seiten wurden darauf hingewiesen, dass mitgehört werden kann.',
  },
} as const;

const pick = (entry: { en: string; de: string }, lang?: string) =>
  lang?.startsWith('de') ? entry.de : entry.en;

/** How long the panel stays up saying the call ended, before it collapses. */
const ENDED_LINGER_MS = 3_000;

function LevelMeter({ label, level, muted, onToggle }: {
  label: string;
  level: number;
  muted: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={muted}
        aria-label={`${muted ? 'Unmute' : 'Mute'} ${label}`}
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors',
          muted
            ? 'border-[var(--line)] text-[var(--text-5)]'
            : 'border-[var(--ink)] text-[var(--ink)]',
        )}
        title={`${muted ? 'Unmute' : 'Mute'} ${label}`}
      >
        {muted ? <MicOff className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
      </button>
      <span className="w-14 shrink-0 text-[11px] text-[var(--text-4)]">{label}</span>
      <span
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--sand-deep)]"
        role="img"
        aria-label={`${label} level`}
      >
        <span
          className={cn('block h-full rounded-full transition-[width] duration-75', muted ? 'bg-[var(--line)]' : 'bg-[var(--ink)]')}
          style={{ width: `${Math.round(Math.min(1, muted ? 0 : level) * 100)}%` }}
        />
      </span>
    </div>
  );
}

export default function ListenIn({ call }: { call: ActiveCall }) {
  const { i18n } = useTranslation();
  const lang = i18n.language;

  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ListenState>('idle');
  const [reason, setReason] = useState<ListenEndReason | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [levels, setLevels] = useState({ inbound: 0, outbound: 0 });
  const [muted, setMuted] = useState<Record<ListenTrack, boolean>>({ inbound: false, outbound: false });
  const [masterMuted, setMasterMuted] = useState(false);
  const [listeners, setListeners] = useState(call.listener_count ?? 0);

  const client = useRef<ListenClient | null>(null);
  const audio = useRef<ListenAudio | null>(null);
  const meterTimer = useRef<number | null>(null);

  const teardown = useCallback(() => {
    if (meterTimer.current) window.clearInterval(meterTimer.current);
    meterTimer.current = null;
    client.current?.close();
    client.current = null;
    void audio.current?.stop();
    audio.current = null;
  }, []);

  // Leaving the page, or the row disappearing, must not leave a socket open.
  useEffect(() => teardown, [teardown]);

  // The call ending closes the panel on its own, after saying so.
  useEffect(() => {
    if (state !== 'ended') return;
    const timer = window.setTimeout(() => {
      setOpen(false);
      setState('idle');
    }, ENDED_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const start = async () => {
    setOpen(true);
    setReason(null);
    setDetail(null);

    const sink = new ListenAudio();
    if (!sink.supported) {
      setState('error');
      setDetail(pick(T.unsupported, lang));
      return;
    }
    audio.current = sink;
    try {
      // Inside the click handler: this is the gesture the browser wants.
      await sink.start();
    } catch (err) {
      setState('error');
      setDetail(err instanceof Error ? err.message : String(err));
      return;
    }

    meterTimer.current = window.setInterval(() => {
      if (audio.current) setLevels(audio.current.getLevels());
    }, 100);

    const session = new ListenClient(call.call_sid, {
      onState: setState,
      onFrame: (frame) => audio.current?.push(frame.track, frame.payload),
      onListeners: setListeners,
      onEnd: (why, why_detail) => {
        setReason(why);
        if (why_detail) setDetail(why_detail);
        if (meterTimer.current) window.clearInterval(meterTimer.current);
        meterTimer.current = null;
        void audio.current?.stop();
        audio.current = null;
      },
    });
    client.current = session;
    session.connect();
  };

  const stop = () => {
    teardown();
    setOpen(false);
    setState('idle');
    setLevels({ inbound: 0, outbound: 0 });
  };

  const toggleTrack = (track: ListenTrack) => {
    const next = !muted[track];
    setMuted((m) => ({ ...m, [track]: next }));
    audio.current?.setTrackMuted(track, next);
  };

  const toggleMaster = () => {
    const next = !masterMuted;
    setMasterMuted(next);
    audio.current?.setMasterMuted(next);
  };

  // No endpoint, no button: the feature announces itself only where the
  // backend says this call can actually be listened to.
  if (!call.listen_available) return null;

  const atCapacity = reason === 'capacity';
  const busy = state === 'connecting' || state === 'reconnecting';

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => void start()}
        className="flex h-7 items-center gap-1.5 rounded-full border border-[var(--line)] px-2.5 text-[11px] font-medium text-[var(--text-3)] transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)]"
        title={pick(T.listen, lang)}
      >
        <Headphones className="h-3.5 w-3.5" />
        {pick(T.listen, lang)}
        {listeners > 0 && <span className="text-[var(--text-5)]">· {listeners}</span>}
      </button>
    );
  }

  return (
    <div className="w-full rounded-[10px] border border-[var(--line)] bg-[var(--paper)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--ink)]">
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-4)]" />
          ) : (
            <span className={cn('h-2 w-2 rounded-full', state === 'listening' ? 'animate-pulse bg-green-500' : 'bg-[var(--line)]')} />
          )}
          {state === 'listening'
            ? pick(T.live, lang)
            : state === 'reconnecting'
              ? pick(T.reconnecting, lang)
              : state === 'connecting'
                ? pick(T.connecting, lang)
                : atCapacity
                  ? pick(T.capacity, lang)
                  : state === 'ended'
                    ? pick(T.callEnded, lang)
                    : pick(T.failed, lang)}
        </span>

        {listeners > 0 && (
          <span className="text-[11px] text-[var(--text-5)]">
            {listeners} {pick(T.listeners, lang)}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleMaster}
            aria-pressed={masterMuted}
            aria-label={masterMuted ? 'Unmute' : 'Mute'}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--line)] text-[var(--text-4)] transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)]"
          >
            {masterMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={stop}
            className="flex h-7 items-center gap-1 rounded-full border border-[var(--line)] px-2.5 text-[11px] font-medium text-[var(--text-3)] transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)]"
          >
            <X className="h-3 w-3" />
            {pick(T.stop, lang)}
          </button>
        </div>
      </div>

      {state === 'listening' && (
        <div className="mt-2.5 space-y-1.5">
          <LevelMeter
            label={pick(T.caller, lang)}
            level={levels.inbound}
            muted={muted.inbound}
            onToggle={() => toggleTrack('inbound')}
          />
          <LevelMeter
            label={pick(T.agent, lang)}
            level={levels.outbound}
            muted={muted.outbound}
            onToggle={() => toggleTrack('outbound')}
          />
        </div>
      )}

      {detail && <p className="mt-2 text-[11px] text-[var(--text-5)]">{detail}</p>}

      {/* The legal half of the feature: monitoring is only acceptable because
          the call announcement covers it, and the person listening should be
          reminded that the other side knows. */}
      {state === 'listening' && (
        <p className="mt-2 text-[10.5px] text-[var(--text-5)]">{pick(T.announced, lang)}</p>
      )}
    </div>
  );
}
