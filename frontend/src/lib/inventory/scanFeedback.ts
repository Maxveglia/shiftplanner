// The beep a scanner gun makes, for the camera and the gun alike.
//
// Receiving is done looking at the boxes, not at the screen: the sound is how
// the manager knows the read happened without looking down, and a different
// sound is how they know this code is not one of theirs yet. The vibration is
// for the loading bay where nobody can hear anything.
//
// Everything here is best-effort and swallowed. A missing beep is a small
// loss; an exception thrown out of the handler that is saving a scan would
// lose the scan.

type AudioCtor = typeof AudioContext;

// One context for the whole page, made on first use: browsers cap how many
// can exist, and each one holds an audio device open.
// undefined = not tried yet; null = this browser has none.
let ctx: AudioContext | null | undefined;

function audio(): AudioContext | null {
  // A closed context never plays again; make a new one rather than beep
  // into nothing for the rest of the session.
  if (ctx && ctx.state === 'closed') ctx = undefined;
  if (ctx !== undefined) return ctx;
  try {
    const w = globalThis as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    ctx = Ctor ? new Ctor() : null;
  } catch {
    ctx = null;
  }
  return ctx;
}

/**
 * Call from a tap (the button that opens the camera, any touch on it).
 *
 * iOS starts every AudioContext suspended and only lets a user gesture resume
 * it; a beep scheduled on a suspended context is silently never heard. The
 * camera's reads do not come from a gesture, so something that did has to
 * wake the context first. Harmless everywhere else.
 */
export function unlockScanFeedback(): void {
  try {
    const a = audio();
    if (a && a.state !== 'running') void a.resume().catch(() => {});
  } catch {
    // nothing to unlock
  }
}

/** One tone with a soft attack and release, so it does not click. */
function tone(a: AudioContext, freq: number, start: number, length: number): void {
  const osc = a.createOscillator();
  const gain = a.createGain();
  // Square rather than sine: it is what a gun sounds like, and a pure sine
  // at this volume disappears under a truck's engine.
  osc.type = 'square';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.12, start + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(a.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

/** A short beep and a vibration where the device has them; silent no-op otherwise. Never throws. */
export function scanFeedback(kind: 'known' | 'unknown'): void {
  try {
    // iPhones have no Vibration API at all; Chrome ignores it (with a console
    // note) until the page has been tapped once.
    const nav = globalThis.navigator as Navigator | undefined;
    if (nav && typeof nav.vibrate === 'function') {
      nav.vibrate(kind === 'known' ? 40 : [90, 60, 90]);
    }
  } catch {
    // no vibration
  }
  try {
    const a = audio();
    if (!a) return;
    if (a.state !== 'running') void a.resume().catch(() => {});
    const now = a.currentTime;
    if (kind === 'known') {
      // One high, short beep: "got it".
      tone(a, 1800, now, 0.08);
    } else {
      // Two low, falling ones: "read it, but it is not one of yours".
      tone(a, 520, now, 0.1);
      tone(a, 390, now + 0.15, 0.14);
    }
  } catch {
    // no sound
  }
}
