// Which barcode reader sits behind the camera, and what can go wrong opening it.
//
// Two readers are possible. The browser's own BarcodeDetector (Chrome on
// Android and on macOS) is fast and costs nothing to load. No browser on an
// iPhone has one -- they are all WebKit underneath, Chrome and Firefox
// included -- so there the reader is ZXing compiled to WebAssembly, through
// barcode-detector's ponyfill: about a megabyte, fetched the first time the
// camera opens and only on a phone that needs it.
//
// The decisions are pure functions of what the browser says it can do, so a
// test can hand them any browser. The loading underneath is the thin part.

/**
 * What a delivery actually carries, and nothing else.
 *
 * - ean_13, ean_8, upc_a, upc_e: the code on every retail unit (EAN in Spain,
 *   UPC on anything imported from the US).
 * - itf: ITF-14, the one printed on the outer carton -- the box of 24 that
 *   comes off the truck, which is exactly what gets scanned at receiving.
 * - code_128: GS1-128 on pallets, and most distributors' own labels.
 * - code_39: older in-house labels still found in stockrooms.
 *
 * No QR on purpose: the QR on a delivery note is a URL, and reading one would
 * offer to create a product called "https://...".
 */
export const SCAN_FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'itf',
  'code_128',
  'code_39',
] as const;

export type ScanFormat = (typeof SCAN_FORMATS)[number];

export type DetectorKind = 'native' | 'wasm';

export interface DetectorChoice {
  kind: DetectorKind;
  /** What to ask that reader for. */
  formats: string[];
}

/**
 * Formats a native reader may leave off its list and still read, because it
 * reads them as another one.
 *
 * A UPC-A is an EAN-13 with a leading zero. Chrome on macOS lists no `upc_a`
 * (measured, Chrome 151: its list is the Vision framework's) and reads a UPC-A
 * as `ean_13` "0036000291452" -- which the barcode key turns into the same
 * GTIN-14 as "036000291452". Refusing that reader for a missing name would
 * send every Mac to the megabyte of wasm for nothing.
 */
const COVERED_BY: Partial<Record<ScanFormat, ScanFormat>> = { upc_a: 'ean_13' };

/**
 * The native reader only if it reads EVERY format above; otherwise the wasm one.
 *
 * Not "whichever reads more of them". A native reader that knew EAN but not
 * ITF would read each unit and silently ignore the carton code of the same
 * product: the manager holds the phone up to the box, nothing happens, and
 * there is no way for them to know why. The wasm reader always reads all of
 * them, so a partial native one is the worse of the two.
 *
 * `nativeFormats` is what `BarcodeDetector.getSupportedFormats()` answered,
 * or null when there is no BarcodeDetector at all (every iPhone) or asking
 * failed. Chrome on desktop Linux and Windows is the case in between: the
 * class can exist and answer an empty list.
 */
export function chooseDetector(nativeFormats: readonly string[] | null): DetectorChoice {
  const wasm: DetectorChoice = { kind: 'wasm', formats: [...SCAN_FORMATS] };
  if (!nativeFormats) return wasm;
  const supported = new Set(nativeFormats);
  const reads = (f: ScanFormat) => supported.has(f) || supported.has(COVERED_BY[f] ?? f);
  if (!SCAN_FORMATS.every(reads)) return wasm;
  // Only names it listed: the spec lets a reader reject one it does not know.
  return { kind: 'native', formats: SCAN_FORMATS.filter((f) => supported.has(f)) };
}

/** Why the camera is not showing a picture. Each one has its own sentence. */
export type CameraProblem =
  | 'denied' // the person (or the site's settings) said no
  | 'insecure' // not https: browsers only hand the camera to a secure page
  | 'unsupported' // this browser has no getUserMedia at all
  | 'no-camera' // the device has none (a desktop without a webcam)
  | 'busy' // another app holds it (a video call, the native camera app)
  | 'ended' // it was taken away mid-scan (the phone locked, the app switched)
  | 'reader' // the camera works but the code reader failed to load
  | 'error'; // anything else

/** Before asking for the camera: can this page ask at all? */
export function cameraSupport(env: {
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
}): 'ok' | 'insecure' | 'unsupported' {
  // Insecure first: on plain http Safari and Chrome both HIDE mediaDevices, so
  // "unsupported" would be the wrong thing to tell someone whose browser is
  // perfectly able and whose URL is the problem.
  if (!env.isSecureContext) return 'insecure';
  if (!env.hasGetUserMedia) return 'unsupported';
  return 'ok';
}

/**
 * What a getUserMedia rejection means, by the error's `name`.
 *
 * The names are the spec's plus the pre-standard ones older Chrome and
 * Android WebViews still throw (PermissionDeniedError, DevicesNotFoundError,
 * TrackStartError).
 */
export function classifyCameraError(name: string | undefined | null): CameraProblem {
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    // Firefox's answer when a policy, not the person, forbids the camera.
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    // Only reachable if a constraint is ever made exact; `ideal` never throws it.
    case 'OverconstrainedError':
      return 'no-camera';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'busy';
    default:
      return 'error';
  }
}

/** The one method both readers share, which is all the scanner uses. */
export interface CodeDetector {
  detect(source: HTMLVideoElement): Promise<ReadonlyArray<{ rawValue: string }>>;
}

interface NativeDetectorClass {
  new (options: { formats: string[] }): CodeDetector;
  getSupportedFormats(): Promise<string[]>;
}

/** The browser's own BarcodeDetector, if it has one. */
function nativeClass(): NativeDetectorClass | null {
  const ctor = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  return typeof ctor === 'function' && typeof ctor.getSupportedFormats === 'function'
    ? ctor
    : null;
}

async function nativeFormats(ctor: NativeDetectorClass | null): Promise<string[] | null> {
  if (!ctor) return null;
  try {
    return await ctor.getSupportedFormats();
  } catch {
    return null;
  }
}

type Ponyfill = typeof import('barcode-detector/ponyfill');

// One download per page, however many times the camera is opened. Reset on
// failure so that "Try again" really tries again.
let wasmReader: Promise<Ponyfill> | null = null;

function loadWasmReader(): Promise<Ponyfill> {
  wasmReader ??= (async () => {
    // Both imports are dynamic so neither lands in the main bundle: a manager
    // on Android, or one who never opens the camera, never downloads them.
    const [ponyfill, wasm] = await Promise.all([
      import('barcode-detector/ponyfill'),
      // The .wasm as a file of OUR build, with a hashed name under /assets.
      // Left alone, zxing-wasm fetches it from jsDelivr, which production's
      // `connect-src 'self'` refuses -- and a camera that opens and never
      // reads anything is the failure nobody can diagnose from a phone. The
      // file has to be the one this exact ponyfill was built against; the
      // test next to this file checks its SHA-256 against the ponyfill's.
      import('zxing-wasm/reader/zxing_reader.wasm?url'),
    ]);
    const wasmUrl = wasm.default;
    // `fireImmediately` so that a failure (no connection, or a CSP without
    // 'wasm-unsafe-eval') surfaces here, once, as a rejection -- instead of
    // as every frame's detect() failing while the picture looks fine.
    await ponyfill.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith('.wasm') ? wasmUrl : prefix + path,
      },
      fireImmediately: true,
    });
    return ponyfill;
  })().catch((e: unknown) => {
    wasmReader = null;
    throw e;
  });
  return wasmReader;
}

/** The reader to scan with, ready to use (for the wasm one: downloaded and compiled). */
export async function createDetector(): Promise<{ kind: DetectorKind; detector: CodeDetector }> {
  const ctor = nativeClass();
  const choice = chooseDetector(await nativeFormats(ctor));
  if (ctor && choice.kind === 'native') {
    return { kind: 'native', detector: new ctor({ formats: choice.formats }) };
  }
  const ponyfill = await loadWasmReader();
  return { kind: 'wasm', detector: new ponyfill.BarcodeDetector({ formats: [...SCAN_FORMATS] }) };
}
