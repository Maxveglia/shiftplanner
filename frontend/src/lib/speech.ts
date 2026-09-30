// Talking instead of typing: the browser's own speech recognition.
//
// Nothing leaves the page except through the browser's built-in recogniser,
// which is Chrome's, Safari's or Edge's -- there is no audio sent to our
// server and no key involved. Where the browser has none (Firefox, some
// WebViews) `supported` is false and the caller shows no microphone at all;
// a button that does nothing is worse than no button.
//
// One utterance at a time: it listens until the speaker pauses, hands back
// the text, and stops. The text lands in the input rather than being sent,
// so a misheard word is corrected before anyone reads it.

import { useCallback, useEffect, useRef, useState } from 'react';

// The Web Speech API is not in every lib.dom; this is the slice used here.
interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
}
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** BCP-47 tag for the recogniser, from the app's two-letter language. */
export function speechLocale(language: string): string {
  return language.toLowerCase().startsWith('es') ? 'es-ES' : 'en-US';
}

export interface SpeechInput {
  supported: boolean;
  listening: boolean;
  /** What has been heard so far in this utterance, interim included. */
  interim: string;
  start: () => void;
  stop: () => void;
}

export function useSpeechInput(
  language: string,
  onFinal: (text: string) => void,
): SpeechInput {
  const Ctor = recognitionCtor();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const recRef = useRef<RecognitionLike | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = speechLocale(language);
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    rec.onresult = (e) => {
      let heard = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else heard += r[0].transcript;
      }
      setInterim(finalText + heard);
    };
    rec.onerror = () => {
      // "no-speech", "not-allowed" and friends all end the same way: the
      // microphone goes quiet and the manager types instead.
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      setInterim('');
      const text = finalText.trim();
      if (text) onFinalRef.current(text);
    };
    recRef.current = rec;
    setInterim('');
    setListening(true);
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setListening(false);
    }
  }, [Ctor, language]);

  // Unmounting mid-sentence must not leave a recogniser running.
  useEffect(() => () => recRef.current?.abort(), []);

  return { supported: Ctor !== null, listening, interim, start, stop };
}
