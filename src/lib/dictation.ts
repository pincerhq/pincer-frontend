/**
 * Voice dictation for the chat composer, on the browser's Web Speech API
 * (`SpeechRecognition`, `webkitSpeechRecognition` in Chrome/Safari).
 *
 * Spoken words — interim and final — are written after whatever was already
 * typed when listening started; dictation never sends. Where the API is
 * missing (Firefox) `supported` is false and the caller hides the mic.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a restart waits for a stopped session's last words before giving up on them. */
const SETTLE_TIMEOUT_MS = 1_500;

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

/** `text` without its first `count` words; whatever follows them, leading space included. */
function afterWords(text: string, count: number): string {
  if (count === 0) return text;
  const words = [...text.matchAll(/\S+/g)];
  if (words.length <= count) return '';
  return text.slice(words[count - 1].index + words[count - 1][0].length);
}

/** How many leading results are final — the part of the list the engine no longer changes. */
function leadingFinals(results: RecognitionResultList): number {
  let i = 0;
  while (i < results.length && results[i].isFinal) i++;
  return i;
}

/**
 * What one session has written into the box, and which spoken words the user
 * already has on screen. `from` and `seen` mark the last edit: results before
 * `from` were on screen then, and so were the first words of the rest
 * (`seen`). `finals` and `tail` are the same pair as of the last update.
 */
export interface DictationTrack {
  base: string;
  suffix: string;
  from: number;
  seen: string;
  finals: number;
  tail: string;
}

export const NEW_TRACK: DictationTrack = { base: '', suffix: '', from: 0, seen: '', finals: 0, tail: '' };

/**
 * One recognition update applied to the box. Only the text dictation itself
 * wrote is ever replaced: if the box still ends with it, everything before it
 * (the user's edits included) is kept. If the user changed the dictated words
 * or typed after them, the box is taken as is, and the words that were on
 * screen at that moment are skipped from then on — by position among the
 * final results, which the engine never changes, and by word count within
 * the interim tail, which it may still revise or (Chrome) merge into one
 * final. Every word said after the edit lands, mid-phrase included.
 */
export function followDictation(
  track: DictationTrack,
  current: string,
  results: RecognitionResultList,
): { track: DictationTrack; text: string } {
  let { base, from, seen } = track;
  if (current.endsWith(track.suffix)) {
    base = current.slice(0, current.length - track.suffix.length);
  } else {
    base = current;
    from = track.finals;
    seen = track.tail;
  }
  const seenWords = seen.match(/\S+/g)?.length ?? 0;
  const text = dictatedText(base, afterWords(transcriptOf(results, from), seenWords));
  const finals = leadingFinals(results);
  return {
    text,
    track: { base, suffix: text.slice(base.length), from, seen, finals, tail: transcriptOf(results, finals) },
  };
}

export function useDictation(opts: { getText: () => string; setText: (text: string) => void; lang: () => string }) {
  const [supported] = useState(() => recognitionCtor() !== undefined);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  /** A stopped session still delivering its last words, until its onend settles it. */
  const settlingRef = useRef<Recognition | null>(null);
  /** A restart asked for while a stopped session was settling: it begins once that one ends. */
  const queuedRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  /** Silence a settling session for good: no more results, no onend. */
  const dropSettling = useCallback(() => {
    const settling = settlingRef.current;
    if (!settling) return;
    settlingRef.current = null;
    settling.onresult = null;
    settling.onend = null;
    settling.abort();
  }, []);

  const unqueue = useCallback(() => {
    if (queuedRef.current === null) return false;
    clearTimeout(queuedRef.current);
    queuedRef.current = null;
    return true;
  }, []);

  const begin = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = speechLang(optsRef.current.lang());
    rec.continuous = true;
    rec.interimResults = true;
    let track = NEW_TRACK;
    rec.onresult = (e) => {
      // Session token: only the live recognizer, or a stopped one that has not
      // settled yet, may write — a restart waits for that settling to finish.
      if (recRef.current !== rec && settlingRef.current !== rec) return;
      const next = followDictation(track, optsRef.current.getText(), e.results);
      track = next.track;
      optsRef.current.setText(next.text);
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

  /** Detach first, so nothing the engine delivers afterwards reaches the box. */
  const end = useCallback((how: 'stop' | 'abort') => {
    // A restart still waiting for a settling session is called off too.
    if (unqueue() && !recRef.current) setListening(false);
    // Send, offline and unmount must also silence a stopped session that is
    // still settling, or its last result lands in a box that was just cleared.
    if (how === 'abort') dropSettling();
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    rec.onerror = null;
    if (how === 'abort') {
      rec.onresult = null;
      rec.onend = null;
    } else {
      // Stop: the engine may still deliver what it already heard; once it
      // settles (onend), nothing more from it reaches the box, and a restart
      // queued meanwhile begins.
      settlingRef.current = rec;
      rec.onend = () => {
        rec.onresult = null;
        if (settlingRef.current === rec) settlingRef.current = null;
        if (unqueue()) begin();
      };
    }
    rec[how]();
    setListening(false);
  }, [begin, dropSettling, unqueue]);

  const start = useCallback(() => {
    if (!recognitionCtor() || recRef.current || queuedRef.current !== null) return;
    if (!settlingRef.current) {
      begin();
      return;
    }
    // A stopped session is still delivering the phrase on screen: let it finish,
    // then begin. Should the engine never settle, give up on those words.
    setError(null);
    setListening(true);
    queuedRef.current = setTimeout(() => {
      queuedRef.current = null;
      dropSettling();
      begin();
    }, SETTLE_TIMEOUT_MS);
  }, [begin, dropSettling]);

  /** Second click: let the engine deliver what it already heard, then end. */
  const stop = useCallback(() => end('stop'), [end]);
  /** Send, offline, unmount: end now and drop anything still in flight. */
  const cancel = useCallback(() => end('abort'), [end]);

  useEffect(() => cancel, [cancel]);

  return { supported, listening, error, start, stop, cancel };
}
