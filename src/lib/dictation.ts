/**
 * Voice dictation for the chat composer, on the browser's Web Speech API
 * (`SpeechRecognition`, `webkitSpeechRecognition` in Chrome/Safari).
 *
 * Spoken words — interim and final — are written after whatever was already
 * typed when listening started; dictation never sends. Where the API is
 * missing (Firefox) `supported` is false and the caller hides the mic.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** UI language → recognition language. Unlisted codes are passed through. */
const SPEECH_LANGS: Record<string, string> = { en: 'en-US', de: 'de-DE', uk: 'uk-UA' };

/** Readable text for SpeechRecognition `error` codes; anything else gets the generic line. */
const ERROR_TEXT: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it in the browser to dictate.',
  'service-not-allowed': 'Microphone access is blocked. Allow it in the browser to dictate.',
  'audio-capture': 'No microphone was found.',
  'no-speech': 'No speech was heard. Try again.',
  network: 'Dictation stopped: speech recognition needs a network connection.',
};

interface RecognitionResultList {
  length: number;
  [index: number]: { isFinal: boolean; 0: { transcript: string } };
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function speechLang(uiLanguage: string | undefined): string {
  const base = (uiLanguage ?? 'en').split('-')[0].toLowerCase();
  return SPEECH_LANGS[base] ?? base;
}

/** Spoken text joined onto what was typed, with one space between words. */
export function dictatedText(typed: string, spoken: string): string {
  const words = spoken.trimStart();
  if (!words) return typed;
  if (!typed || /\s$/.test(typed)) return typed + words;
  return `${typed} ${words}`;
}

/** The session's results from `from` on, interim included, as one string. */
function transcriptOf(results: RecognitionResultList, from = 0): string {
  let out = '';
  for (let i = from; i < results.length; i++) {
    const piece = results[i][0].transcript;
    out = out && piece && !/\s$/.test(out) && !/^\s/.test(piece) ? `${out} ${piece}` : out + piece;
  }
  return out;
}

/** How many results at the start of the list are final (finals never change again). */
function finalCount(results: RecognitionResultList): number {
  let n = 0;
  while (n < results.length && results[n].isFinal) n++;
  return n;
}

export function useDictation(opts: { getText: () => string; setText: (text: string) => void; lang: () => string }) {
  const [supported] = useState(() => recognitionCtor() !== undefined);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  /** A stopped session still delivering its last words, until its onend settles it. */
  const settlingRef = useRef<Recognition | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  /** Detach first, so nothing the engine delivers afterwards reaches the box. */
  const end = useCallback((how: 'stop' | 'abort') => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    rec.onerror = null;
    if (how === 'abort') {
      rec.onresult = null;
      rec.onend = null;
    } else {
      // Stop: the engine may still deliver what it already heard; once it
      // settles (onend), nothing more from it reaches the box.
      settlingRef.current = rec;
      rec.onend = () => {
        rec.onresult = null;
        if (settlingRef.current === rec) settlingRef.current = null;
      };
    }
    rec[how]();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = speechLang(optsRef.current.lang());
    rec.continuous = true;
    rec.interimResults = true;
    // Only the text dictation itself wrote is ever replaced. Each result re-reads
    // the box: if it still ends with what was dictated last, everything before
    // that (the user's edits included) is kept; if the user changed the dictated
    // words or typed after them, the box is taken as is and only results that
    // arrive after the edit are appended.
    const session = { base: '', suffix: '', from: 0, finals: 0 };
    rec.onresult = (e) => {
      // Session token: only the live recognizer — or a stopped one that has not
      // settled while no newer session runs — may write to the box.
      const live = recRef.current === rec;
      const settling = settlingRef.current === rec && recRef.current === null;
      if (!live && !settling) return;
      const current = optsRef.current.getText();
      if (current.endsWith(session.suffix)) {
        session.base = current.slice(0, current.length - session.suffix.length);
      } else {
        session.base = current;
        session.from = session.finals;
      }
      const next = dictatedText(session.base, transcriptOf(e.results, session.from));
      session.suffix = next.slice(session.base.length);
      session.finals = finalCount(e.results);
      optsRef.current.setText(next);
    };
    rec.onerror = (e) => {
      if (e.error !== 'aborted') setError(ERROR_TEXT[e.error] ?? `Dictation stopped (${e.error}).`);
    };
    rec.onend = () => {
      if (recRef.current === rec) recRef.current = null;
      setListening(false);
    };
    recRef.current = rec;
    setError(null);
    setListening(true);
    rec.start();
  }, []);

  /** Second click: let the engine deliver what it already heard, then end. */
  const stop = useCallback(() => end('stop'), [end]);
  /** Send, offline, unmount: end now and drop anything still in flight. */
  const cancel = useCallback(() => end('abort'), [end]);

  useEffect(() => cancel, [cancel]);

  return { supported, listening, error, start, stop, cancel };
}
