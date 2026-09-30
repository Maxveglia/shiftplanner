import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ZXING_WASM_SHA256 } from 'barcode-detector/ponyfill';
// The very import cameraDetector makes, resolved by the same Vite pipeline.
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import {
  SCAN_FORMATS,
  cameraSupport,
  chooseDetector,
  classifyCameraError,
} from './cameraDetector';

// What getSupportedFormats() answers on the browsers that have a reader.
// macOS measured on Chrome 151 (the Vision framework's list); Android is
// ML Kit's, as Chromium's Android implementation declares it.
const CHROME_MACOS = [
  'aztec', 'code_128', 'code_39', 'code_93', 'data_matrix', 'ean_13', 'ean_8',
  'itf', 'pdf417', 'qr_code', 'upc_e',
];
const CHROME_ANDROID = [
  'aztec', 'code_128', 'code_39', 'code_93', 'codabar', 'data_matrix', 'ean_13',
  'ean_8', 'itf', 'pdf417', 'qr_code', 'upc_a', 'upc_e',
];

describe('chooseDetector', () => {
  it('uses the wasm reader when there is no BarcodeDetector (every iPhone)', () => {
    expect(chooseDetector(null)).toEqual({ kind: 'wasm', formats: [...SCAN_FORMATS] });
  });

  it('uses the native reader when it reads every format a delivery carries', () => {
    expect(chooseDetector(CHROME_ANDROID)).toEqual({ kind: 'native', formats: [...SCAN_FORMATS] });
    expect(chooseDetector([...SCAN_FORMATS]).kind).toBe('native');
  });

  it('takes ean_13 as covering upc_a, which such a reader reads as EAN-13', () => {
    const choice = chooseDetector(CHROME_MACOS);
    expect(choice.kind).toBe('native');
    // ...and does not ask it for a name it never listed.
    expect(choice.formats).not.toContain('upc_a');
    expect(choice.formats).toEqual(['ean_13', 'ean_8', 'upc_e', 'itf', 'code_128', 'code_39']);
  });

  it('does not take upc_a as covering ean_13 the other way round', () => {
    const noEan13 = SCAN_FORMATS.filter((f) => f !== 'ean_13');
    expect(chooseDetector(noEan13).kind).toBe('wasm');
  });

  it('uses the wasm reader when the native one misses even one format', () => {
    // No ITF: the carton code of every product would scan as nothing.
    expect(chooseDetector(CHROME_MACOS.filter((f) => f !== 'itf')).kind).toBe('wasm');
    expect(chooseDetector(SCAN_FORMATS.filter((f) => f !== 'code_39')).kind).toBe('wasm');
  });

  it('uses the wasm reader when the native class exists but reads nothing', () => {
    // Chrome on desktop Linux and Windows.
    expect(chooseDetector([]).kind).toBe('wasm');
  });

  it('asks for the retail and carton codes, and never for QR', () => {
    expect(SCAN_FORMATS).toEqual(
      expect.arrayContaining(['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'code_128', 'code_39']),
    );
    expect(SCAN_FORMATS).not.toContain('qr_code');
    expect(chooseDetector(CHROME_ANDROID).formats).not.toContain('qr_code');
  });
});

describe('cameraSupport', () => {
  it('can ask for the camera on a secure page that has getUserMedia', () => {
    expect(cameraSupport({ isSecureContext: true, hasGetUserMedia: true })).toBe('ok');
  });

  it('blames the http, not the browser, when the page is not secure', () => {
    // On plain http the browser hides mediaDevices as well, so both are false.
    expect(cameraSupport({ isSecureContext: false, hasGetUserMedia: false })).toBe('insecure');
  });

  it('says the browser cannot when a secure page still has no getUserMedia', () => {
    expect(cameraSupport({ isSecureContext: true, hasGetUserMedia: false })).toBe('unsupported');
  });
});

describe('classifyCameraError', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['PermissionDeniedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'no-camera'],
    ['DevicesNotFoundError', 'no-camera'],
    ['OverconstrainedError', 'no-camera'],
    ['NotReadableError', 'busy'],
    ['TrackStartError', 'busy'],
    ['AbortError', 'error'],
    ['TypeError', 'error'],
  ] as const)('%s → %s', (name, problem) => {
    expect(classifyCameraError(name)).toBe(problem);
  });

  it('treats a rejection with no name as a plain error', () => {
    expect(classifyCameraError(undefined)).toBe('error');
    expect(classifyCameraError(null)).toBe('error');
  });
});

describe('the wasm the build serves', () => {
  // cameraDetector serves `zxing-wasm/reader/zxing_reader.wasm` itself and
  // hands it to barcode-detector's ponyfill, which carries its own copy of the
  // ZXing glue code. The two packages are versioned separately (and zxing-wasm
  // is only here as the ponyfill's dependency); a .wasm from one version driven
  // by the glue of another fails in ways that look like "the camera never
  // reads anything". This is the check that they are the same build.
  it('is the exact file the ponyfill was built against', async () => {
    // Served from the project root in dev and test ("/node_modules/..."),
    // which is three levels up from this file. Node's fs typed by hand: the
    // repo carries no @types/node.
    expect(wasmUrl).toMatch(/zxing_reader\.wasm$/);
    const file = new URL(`../../..${wasmUrl}`, import.meta.url);
    const bytes = (fs as unknown as { readFileSync(path: URL): Uint8Array<ArrayBuffer> }).readFileSync(file);
    expect(bytes.length).toBeGreaterThan(100_000);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe(ZXING_WASM_SHA256);
  });
});
