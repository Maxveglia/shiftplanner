import { useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import {
  cameraSupport,
  classifyCameraError,
  createDetector,
  type CameraProblem,
  type CodeDetector,
  type DetectorKind,
} from '../../lib/inventory/cameraDetector';
import { createScanDedupe } from '../../lib/inventory/scanDedupe';
import { unlockScanFeedback } from '../../lib/inventory/scanFeedback';
import { Button } from '../Button';

export interface CameraScannerProps {
  /** A code read by the camera. Already de-duplicated: the same code is not repeated within 1500 ms. */
  onCode: (code: string) => void;
  onClose: () => void;
  /** Stop and close after the first code (to fill one field) instead of scanning continuously. */
  once?: boolean;
  className?: string;
}

// About seven looks a second. Barcodes stand still while they are read, so
// more buys nothing but heat: every look is a full frame through the reader,
// and on an iPhone that reader is WebAssembly on the CPU. Looks never overlap
// either -- the next one is scheduled when the last one finishes.
const SCAN_INTERVAL_MS = 140;

// A detect() that fails now and then is a bad frame; one that fails this many
// times in a row is a reader that is broken, and saying so beats a camera that
// shows a picture and never reads anything.
const MAX_DETECT_FAILURES = 10;

// HTMLMediaElement.HAVE_CURRENT_DATA: there is a frame to look at.
const HAVE_CURRENT_DATA = 2;

type Phase =
  | { kind: 'starting' } // asking for the camera
  | { kind: 'preparing' } // the camera is on, the reader is still loading (an iPhone, the first time)
  | { kind: 'scanning' }
  | { kind: 'needs-tap' } // the browser would not play the video without a tap (iOS Low Power Mode)
  | { kind: 'problem'; problem: CameraProblem };

const PROBLEM_KEY: Record<CameraProblem, string> = {
  denied: 'scanner.problem.denied',
  insecure: 'scanner.problem.insecure',
  unsupported: 'scanner.problem.unsupported',
  'no-camera': 'scanner.problem.noCamera',
  busy: 'scanner.problem.busy',
  ended: 'scanner.problem.ended',
  reader: 'scanner.problem.reader',
  error: 'scanner.problem.error',
};

// Trying again cannot fix these two: the page is on http, or the browser has
// no camera API. Everything else can change under the person's hand -- a
// setting allowed, another app closed, a connection back.
const FINAL: ReadonlySet<CameraProblem> = new Set<CameraProblem>(['insecure', 'unsupported']);

/** Everything that holds the camera open, so that closing can let go of all of it. */
interface Session {
  stop: () => void;
  track: MediaStreamTrack | null;
}

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

/**
 * The phone's camera as a barcode reader.
 *
 * The rear camera fills the box, a frame shows where to aim, and every code
 * read inside it goes to `onCode` once (see scanDedupe). The browser's own
 * reader where it has one; on an iPhone, which never does, the WebAssembly one
 * (see cameraDetector). Closing -- the button, Escape, `once`, or the parent
 * unmounting it -- stops every track, so the camera light goes off.
 */
export function CameraScanner({ onCode, onClose, once = false, className = '' }: CameraScannerProps): JSX.Element {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const session = useRef<Session | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [reader, setReader] = useState<DetectorKind | null>(null);
  const [torch, setTorch] = useState<'none' | 'off' | 'on'>('none');
  const [lastRead, setLastRead] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  // Bumped by "Try again": a new session from scratch.
  const [attempt, setAttempt] = useState(0);

  // The latest props, read from inside the loop. Putting them in the effect's
  // dependencies instead would restart the camera -- a new permission check,
  // the light blinking -- every time the parent re-rendered with a new arrow.
  const onCodeRef = useRef(onCode);
  const onCloseRef = useRef(onClose);
  const onceRef = useRef(once);
  onCodeRef.current = onCode;
  onCloseRef.current = onClose;
  onceRef.current = once;

  // Whether the video is actually playing, and whether the reader is ready:
  // the phase shown depends on both, and they finish in either order.
  const playing = useRef(false);
  const detectorReady = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stopped = false;
    let timer: number | undefined;
    let flashTimer: number | undefined;
    let stream: MediaStream | null = null;

    const stop = () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearTimeout(flashTimer);
      // Every track, not just the video one: a stopped track is the only thing
      // that turns the camera light off. Pausing the <video> does not.
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video.srcObject = null;
    };
    const current: Session = { stop, track: null };
    session.current = current;
    playing.current = false;
    detectorReady.current = false;
    setTorch('none');
    setLastRead(null);
    setReader(null);

    const fail = (problem: CameraProblem) => {
      if (stopped) return;
      stop();
      setPhase({ kind: 'problem', problem });
    };

    const support = cameraSupport({
      isSecureContext: window.isSecureContext,
      hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
    });
    if (support !== 'ok') {
      setPhase({ kind: 'problem', problem: support });
      return stop;
    }
    setPhase({ kind: 'starting' });

    // The camera and the reader at the same time: on an iPhone the reader is
    // a download, and it can arrive while the permission prompt is still up.
    const detectorPromise = createDetector();
    // Handled further down; this only keeps it from counting as "unhandled"
    // if the camera fails first and nobody ever awaits it.
    detectorPromise.catch(() => {});

    const showProgress = () => {
      if (stopped) return;
      if (!playing.current) return;
      setPhase({ kind: detectorReady.current ? 'scanning' : 'preparing' });
    };

    const run = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            // `ideal`, never `exact`: a laptop has only a front camera, and
            // exact would refuse it instead of using it.
            facingMode: { ideal: 'environment' },
            // 720p: enough for an EAN at arm's length, and a quarter of the
            // pixels of 1080p for the wasm reader to go through each look.
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      } catch (e) {
        fail(classifyCameraError((e as { name?: string } | null)?.name));
        return;
      }
      if (stopped) {
        // Closed (or unmounted, or StrictMode's rehearsal) while the prompt
        // was up: this stream arrived after stop() ran, so stop it here or
        // the light stays on with nothing showing it.
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
        return;
      }

      const track = stream.getVideoTracks()[0] ?? null;
      current.track = track;
      // Fired when the camera is taken away (the phone locks, another app
      // grabs it) -- never by our own stop(), so this is always news.
      track?.addEventListener('ended', () => fail('ended'));

      // iOS will not play inline, or without a tap, unless these are real
      // attributes when play() is called; React sets `muted` only as a
      // property, so say both.
      video.muted = true;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.srcObject = stream;
      try {
        await video.play();
        playing.current = true;
      } catch (e) {
        if (stopped) return;
        if ((e as { name?: string } | null)?.name === 'NotAllowedError') {
          setPhase({ kind: 'needs-tap' });
        }
        // Anything else (an AbortError from a quick close) is not the
        // person's problem; the loop below still reads whatever frames come.
      }
      if (stopped) return;
      showProgress();

      // Asked for after play(): some Android cameras report no capabilities
      // until frames are flowing.
      const caps = track?.getCapabilities?.() as TorchCapabilities | undefined;
      if (caps?.torch) setTorch('off');

      let detector: CodeDetector;
      let kind: DetectorKind;
      try {
        ({ detector, kind } = await detectorPromise);
      } catch {
        fail('reader');
        return;
      }
      if (stopped) return;
      detectorReady.current = true;
      setReader(kind);
      showProgress();

      const dedupe = createScanDedupe();
      let failures = 0;
      const tick = async () => {
        if (stopped) return;
        const began = performance.now();
        let found: ReadonlyArray<{ rawValue: string }> = [];
        // Nothing to look at while the tab is hidden or before the first frame.
        if (!document.hidden && video.readyState >= HAVE_CURRENT_DATA && video.videoWidth > 0) {
          try {
            found = await detector.detect(video);
            failures = 0;
          } catch {
            failures += 1;
            if (failures >= MAX_DETECT_FAILURES) {
              fail(kind === 'wasm' ? 'reader' : 'error');
              return;
            }
          }
        }
        for (const { rawValue } of found) {
          if (stopped) return;
          if (!dedupe.accept(rawValue, performance.now())) continue;
          setLastRead(rawValue.trim());
          setFlash(true);
          window.clearTimeout(flashTimer);
          flashTimer = window.setTimeout(() => setFlash(false), 450);
          // Not inside the try above: an exception in the page's handler is
          // the page's bug, not a failing reader. It is rethrown on its own
          // so it still reaches the console, and the loop keeps reading --
          // left to propagate, it would reject this tick and scanning would
          // stop with the picture still moving.
          try {
            onCodeRef.current(rawValue);
          } catch (e) {
            queueMicrotask(() => {
              throw e;
            });
          }
          if (onceRef.current) {
            stop();
            onCloseRef.current();
            return;
          }
        }
        if (stopped) return;
        timer = window.setTimeout(tick, Math.max(0, SCAN_INTERVAL_MS - (performance.now() - began)));
      };
      void tick();
    };
    void run();

    return stop;
  }, [attempt]);

  const close = () => {
    session.current?.stop();
    onClose();
  };

  const retry = () => {
    session.current?.stop();
    setAttempt((n) => n + 1);
  };

  // The tap that iOS insisted on. It is a gesture, so play() is allowed now.
  const tapToStart = () => {
    const video = videoRef.current;
    if (!video) return;
    video
      .play()
      .then(() => {
        playing.current = true;
        setPhase({ kind: detectorReady.current ? 'scanning' : 'preparing' });
      })
      .catch(() => {});
  };

  const toggleTorch = async () => {
    const track = session.current?.track;
    if (!track || torch === 'none') return;
    const next = torch === 'off';
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch(next ? 'on' : 'off');
    } catch {
      // Claimed the capability and then refused it (some Android drivers):
      // take the button away rather than leave one that does nothing.
      setTorch('none');
    }
  };

  // Escape closes the camera, and only the camera, wherever the focus is.
  // Listening on the section instead only heard it with the focus inside,
  // and it rarely is: after the camera button the focus stays on that
  // button, so the Escape reached the Modal around it and closed the whole
  // product form, with what had been typed in it. On window, in the capture
  // phase, it is heard before anything else, and stopped there it never
  // reaches the Modal's own keydown (a React handler on the dialog), nor the
  // receive page's.
  //
  // Except when the focus is in another dialog, one that does not hold the
  // camera: that dialog is on top (the receive page's save form, opened with
  // the camera still on), and its Escape is its own.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return;
      const dialog = document.activeElement?.closest('[role="dialog"]');
      if (dialog && !dialog.contains(sectionRef.current)) return;
      e.preventDefault();
      e.stopPropagation();
      session.current?.stop();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const live = phase.kind === 'scanning' || phase.kind === 'preparing';
  const problem = phase.kind === 'problem' ? phase.problem : null;

  let title: string;
  let help: string | null = null;
  if (problem) {
    title = t(PROBLEM_KEY[problem]);
    if (problem === 'denied') help = t('scanner.problem.denied.help');
  } else if (phase.kind === 'starting') {
    title = t('scanner.starting');
  } else if (phase.kind === 'preparing') {
    title = t('scanner.preparing');
  } else if (phase.kind === 'needs-tap') {
    title = t('scanner.tapToStart');
  } else if (lastRead) {
    title = t('scanner.read', { code: lastRead });
  } else {
    title = t(once ? 'scanner.scanningOnce' : 'scanner.scanning');
  }

  return (
    <section
      ref={sectionRef}
      aria-label={t('scanner.region')}
      data-reader={reader ?? undefined}
      data-phase={problem ?? phase.kind}
      className={`overflow-hidden rounded-2xl bg-black text-white ring-1 ring-white/10 ${className}`}
      // Any touch on the scanner wakes the audio for the beeps (iOS keeps it
      // asleep until a gesture, and reads from the camera are not gestures).
      onPointerDown={unlockScanFeedback}
    >
      {/* overflow-hidden here too, not only on the section: the guide dims the
          picture with a 9999 px shadow, and without it the shadow also dims
          the status line underneath. */}
      <div className="relative aspect-[4/3] max-h-[60vh] w-full overflow-hidden bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          aria-hidden="true"
          className={['absolute inset-0 h-full w-full object-cover', live ? '' : 'opacity-40'].join(' ')}
        />

        {live && (
          // Where to aim: a wide box, because barcodes are wide, with the rest
          // of the picture dimmed so the eye goes to it.
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className={[
                'relative h-[42%] w-[82%] rounded-md shadow-[0_0_0_9999px_rgba(0,0,0,0.38)] transition-[border-color,border-width] duration-150 motion-reduce:transition-none',
                flash ? 'border-4 border-brand-400' : 'border-2 border-white/90',
              ].join(' ')}
            >
              {phase.kind === 'scanning' && (
                <div className="absolute inset-x-3 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/90 animate-pulse motion-reduce:animate-none" />
              )}
              {flash && (
                // A tick as well as the green: the read shows without colour.
                <svg
                  viewBox="0 0 24 24"
                  className="absolute -right-3 -top-3 h-8 w-8 rounded-full bg-brand-400 p-1 text-gray-900"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              )}
            </div>
          </div>
        )}

        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            {phase.kind === 'starting' && (
              <svg
                aria-hidden="true"
                className="h-8 w-8 animate-spin text-brand-300 motion-reduce:animate-none"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
            {problem && (
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-10 w-10 text-amber-300"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {problem === 'denied' ? (
                  // A camera struck through.
                  <>
                    <path d="M3 3l18 18" />
                    <path d="M15 15.5V17a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2h2" />
                    <path d="M11 7h2a2 2 0 012 2v2l5-3v8" />
                  </>
                ) : (
                  <>
                    <path d="M12 9v4" />
                    <path d="M12 17h.01" />
                    <path d="M10.3 3.9L2.4 17.5A2 2 0 004.1 20.5h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
                  </>
                )}
              </svg>
            )}
            {problem && !FINAL.has(problem) && (
              <Button type="button" variant="secondary" onClick={retry} className="min-h-11 min-w-[8rem] px-5 text-base">
                {t('scanner.retry')}
              </Button>
            )}
            {phase.kind === 'needs-tap' && (
              <Button type="button" onClick={tapToStart} className="min-h-12 px-6 text-base">
                {t('scanner.tapToStart')}
              </Button>
            )}
          </div>
        )}

        {/* 48 px each: used with gloves on, next to a truck. */}
        <div className="absolute right-2 top-2 flex gap-2">
          {torch !== 'none' && (
            <button
              type="button"
              onClick={() => void toggleTorch()}
              aria-pressed={torch === 'on'}
              aria-label={t('scanner.torch')}
              className={[
                'flex h-12 w-12 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                torch === 'on' ? 'bg-brand-400 text-ground' : 'bg-black/60 text-white hover:bg-black/75',
              ].join(' ')}
            >
              {/* Filled when on, outlined when off: the state shows without colour. */}
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-6 w-6"
                fill={torch === 'on' ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              >
                <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={close}
            aria-label={t('scanner.close')}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="m-close-x h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>

      {/* One live region, always mounted, so every change of state -- and
          every read -- is announced; a region that appears with its text
          already in it is often not. */}
      <div role="status" aria-live="polite" className="min-h-[3.25rem] px-4 py-3">
        <p className="break-words text-sm font-medium">{title}</p>
        {help && <p className="mt-1 text-sm text-gray-300">{help}</p>}
      </div>
    </section>
  );
}
