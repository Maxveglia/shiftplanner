// Natural-language intake: the manager types or SPEAKS the brief, we parse it
// into structured rules, show exactly what was understood, and only then
// generate. This is the human-in-the-loop contract that Phase 7 keeps when
// Claude replaces the local parser.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { useLanguage, useT } from '../../lib/i18n';
import { dictationLocale } from '../../lib/locale';

// --- Minimal Web Speech API typings (not in lib.dom for all TS versions) ----
interface SpeechRecognitionAlternativeLike { transcript: string }
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
  length: number;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface PromptPanelProps {
  onGenerate: (text: string) => void;
  isGenerating: boolean;
  lastPrompt: string;
  /** Offered only when the server has the interview to offer. */
  onInterview?: () => void;
}

export function PromptPanel({
  onGenerate,
  isGenerating,
  lastPrompt,
  onInterview,
}: PromptPanelProps) {
  const t = useT();
  const { language } = useLanguage();
  const [text, setText] = useState(lastPrompt);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseTextRef = useRef('');
  // How many times the brief has been sent from this panel. Each send draws
  // a light along the box once (`cal-sheen`): the brief being read.
  const [sent, setSent] = useState(0);

  const voiceSupported = typeof window !== 'undefined' && getRecognitionCtor() !== null;

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const toggleVoice = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    setVoiceError(null);
    const rec = new Ctor();
    // Listen in the language the manager CHOSE, not the one their laptop is set
    // to. `navigator.language` was written before the interface had a language
    // of its own, and it is the same mistake dates used to make: a Spanish
    // machine reading an English screen. Here it costs more than a stray month
    // name -- dictation matched against the wrong language does not fail, it
    // transcribes confident nonsense, and the manager watches their brief fill
    // with words they did not say.
    rec.lang = dictationLocale(language);
    rec.continuous = true;
    rec.interimResults = true;
    baseTextRef.current = text ? text.trim() + ' ' : '';

    rec.onresult = (e) => {
      let transcript = '';
      for (let i = 0; i < e.results.length; i += 1) {
        transcript += e.results[i][0].transcript;
      }
      setText(baseTextRef.current + transcript);
    };
    rec.onerror = () => {
      setVoiceError(t('schedule.prompt.voice.micError'));
      setListening(false);
    };
    rec.onend = () => setListening(false);

    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setVoiceError(t('schedule.prompt.voice.startError'));
    }
  }, [listening, text, t, language]);

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-surface p-5 shadow-[0_24px_60px_-36px_rgb(0_0_0/0.8)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            {t('schedule.prompt.title')}
          </h2>
        </div>
      </div>

      <div className="relative">
        {sent > 0 && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg"
          >
            <span key={sent} className="cal-sheen" />
          </span>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder={t('schedule.prompt.placeholder')}
          className="relative block w-full resize-y rounded-xl border border-gray-400 bg-white/[0.04] p-3 pr-12 text-sm text-gray-900 placeholder-gray-500 hover:border-gray-500 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/40"
        />
        <button
          type="button"
          onClick={toggleVoice}
          disabled={!voiceSupported}
          title={
            voiceSupported
              ? listening
                ? t('schedule.prompt.voice.stop')
                : t('schedule.prompt.voice.start')
              : t('schedule.prompt.voice.unsupported')
          }
          aria-label={
            listening
              ? t('schedule.prompt.voice.stop')
              : t('schedule.prompt.voice.startAria')
          }
          className={[
            'absolute right-2.5 top-2.5 flex h-9 w-9 items-center justify-center rounded-full transition-colors',
            !voiceSupported
              ? 'cursor-not-allowed bg-white/[0.04] text-gray-400'
              : listening
                ? 'animate-pulse bg-danger text-white motion-reduce:animate-none'
                : 'bg-white/[0.06] text-gray-700 ring-1 ring-inset ring-white/10 hover:bg-white/[0.1] hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
          ].join(' ')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="2" width="6" height="11" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
          </svg>
        </button>
      </div>

      {listening && (
        <p className="mt-2 flex items-center gap-2 text-sm text-red-600">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-danger motion-reduce:animate-none" />
          {t('schedule.prompt.voice.listening')}
        </p>
      )}
      {voiceError && <p className="mt-2 text-sm text-red-600">{voiceError}</p>}
      {!voiceSupported && (
        <p className="mt-2 text-xs text-gray-500">
          {t('schedule.prompt.voice.browsers')}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button
          onClick={() => {
            setSent((n) => n + 1);
            onGenerate(text);
          }}
          disabled={isGenerating}
        >
          {isGenerating
            ? t('schedule.prompt.generating')
            : t('schedule.prompt.generate')}
        </Button>
        {text && (
          <button
            type="button"
            onClick={() => setText('')}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            {t('schedule.prompt.clear')}
          </button>
        )}
        {onInterview && (
          <button
            type="button"
            onClick={onInterview}
            disabled={isGenerating}
            className="ml-auto text-sm text-brand-300 hover:text-brand-700"
          >
            {t('interview.offer.prompt')}
          </button>
        )}
      </div>

    </div>
  );
}
