import { afterEach, describe, expect, it, vi } from 'vitest';

// scanFeedback keeps one AudioContext per page in module state, so each test
// loads a fresh copy of the module after setting up its fake browser.
async function load() {
  vi.resetModules();
  return import('./scanFeedback');
}

/** Just enough of WebAudio to see which tones were asked for. */
function fakeAudio(opts: { state?: AudioContextState; failConstruct?: boolean } = {}) {
  const tones: number[] = [];
  let made = 0;
  class FakeContext {
    state: AudioContextState = opts.state ?? 'running';
    currentTime = 0;
    destination = {};
    constructor() {
      if (opts.failConstruct) throw new Error('no audio device');
      made += 1;
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    createOscillator() {
      const osc = {
        type: 'sine',
        frequency: { value: 0 },
        connect: (node: unknown) => node,
        start: () => tones.push(osc.frequency.value),
        stop: () => {},
      };
      return osc;
    }
    createGain() {
      const ramp = () => {};
      return {
        gain: { setValueAtTime: ramp, exponentialRampToValueAtTime: ramp },
        connect: (node: unknown) => node,
      };
    }
  }
  vi.stubGlobal('AudioContext', FakeContext);
  return { tones, made: () => made };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scanFeedback', () => {
  it('does nothing, and throws nothing, where there is no audio or vibration', async () => {
    const { scanFeedback, unlockScanFeedback } = await load();
    expect(() => {
      unlockScanFeedback();
      scanFeedback('known');
      scanFeedback('unknown');
    }).not.toThrow();
  });

  it('sounds different for a code that is not one of ours', async () => {
    const audio = fakeAudio();
    const { scanFeedback } = await load();
    scanFeedback('known');
    const known = [...audio.tones];
    audio.tones.length = 0;
    scanFeedback('unknown');
    expect(known).toHaveLength(1);
    expect(audio.tones.length).toBeGreaterThan(1);
    expect(Math.max(...audio.tones)).toBeLessThan(known[0]);
  });

  it('makes one AudioContext for the whole page', async () => {
    const audio = fakeAudio({ state: 'suspended' });
    const { scanFeedback, unlockScanFeedback } = await load();
    unlockScanFeedback();
    scanFeedback('known');
    scanFeedback('unknown');
    scanFeedback('known');
    expect(audio.made()).toBe(1);
  });

  it('never throws, even when the audio device and the vibration both fail', async () => {
    fakeAudio({ failConstruct: true });
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('blocked');
      },
    });
    const { scanFeedback, unlockScanFeedback } = await load();
    expect(() => {
      unlockScanFeedback();
      scanFeedback('known');
      scanFeedback('unknown');
    }).not.toThrow();
  });

  it('vibrates differently for an unknown code', async () => {
    const patterns: unknown[] = [];
    vi.stubGlobal('navigator', { vibrate: (p: unknown) => patterns.push(p) });
    const { scanFeedback } = await load();
    scanFeedback('known');
    scanFeedback('unknown');
    expect(patterns).toHaveLength(2);
    expect(patterns[0]).not.toEqual(patterns[1]);
  });
});
