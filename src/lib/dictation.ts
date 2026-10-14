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

/** The session's results so far, interim included, as one string. */
function transcriptOf(results: RecognitionResultList): string {
  let out = '';
  for (let i = 0; i < results.length; i++) {
    const piece = results[i][0].transcript;
    out = out && piece && !/\s$/.test(out) && !/^\s/.test(piece) ? `${out} ${piece}` : out + piece;
  }
  return out;
}

export function useDictation(opts: { getText: () => string; setText: (text: string) => void; lang: () => string }) {
  const [supported] = useState(() => recognitionCtor() !== undefined);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  /** Detach first, so nothing the engine delivers afterwards reaches the box. */
  const end = useCallback((how: 'stop' | 'abort') => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    if (how === 'abort') rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    rec[how]();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    const typed = optsRef.current.getText();
    rec.lang = speechLang(optsRef.current.lang());
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => optsRef.current.setText(dictatedText(typed, transcriptOf(e.results)));
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
