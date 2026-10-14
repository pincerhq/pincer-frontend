/**
 * Live voice bars for the dictation stop button. Mounted only while listening:
 * mounting opens a local microphone stream and an analyser, unmounting stops
 * the tracks, closes the AudioContext and cancels the animation frame — so
 * every way listening ends (click, Send, offline, leaving, an error) releases
 * the microphone.
 *
 * Heights are written straight to the bars each frame, so the chat page does
 * not re-render sixty times a second. Reduced motion, or no stream (permission
 * refused, no Web Audio), shows a steady indicator; dictation itself does not
 * depend on it.
 */
import { useEffect, useRef, useState } from 'react';
import { ANALYSER_FFT_SIZE, barLevels, prefersReducedMotion } from '@/lib/voiceLevel';

const BARS = 5;
const MIN_PX = 3;
const MAX_PX = 16;
/** The steady indicator: a fixed, symmetric shape that reads as "listening". */
const STEADY_PX = [6, 10, 14, 10, 6];

type AudioContextCtor = new () => AudioContext;

export function VoiceBars() {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const [steady, setSteady] = useState(prefersReducedMotion);

  useEffect(() => {
    if (steady) return;
    let cancelled = false;
    let frame = 0;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;

    const release = () => {
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
      if (ctx && ctx.state !== 'closed') void ctx.close();
    };

    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
        const Ctor = w.AudioContext ?? w.webkitAudioContext;
        if (!Ctor) throw new Error('No Web Audio');
        ctx = new Ctor();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = ANALYSER_FFT_SIZE;
        analyser.smoothingTimeConstant = 0.6;
        ctx.createMediaStreamSource(s).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          barLevels(data, BARS).forEach((level, i) => {
            const el = bars.current[i];
            if (el) el.style.height = `${MIN_PX + level * (MAX_PX - MIN_PX)}px`;
          });
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch {
        release();
        if (!cancelled) setSteady(true);
      }
    })();

    return () => {
      cancelled = true;
      release();
    };
  }, [steady]);

  return (
    <span data-testid="voice-bars" data-steady={steady} aria-hidden="true" className="flex h-4 items-center gap-[2px]">
      {STEADY_PX.map((px, i) => (
        <span
          key={i}
          ref={(el) => {
            bars.current[i] = el;
          }}
          data-testid="voice-bar"
          className="w-[3px] rounded-full bg-[var(--bad-fg)]"
          style={{ height: `${steady ? px : MIN_PX}px` }}
        />
      ))}
    </span>
  );
}
