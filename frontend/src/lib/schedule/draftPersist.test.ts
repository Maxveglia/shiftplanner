import { describe, expect, it } from 'vitest';
import { decodeDraft, encodeDraft, writeDraft } from './draftPersist';

describe('encode / decode', () => {
  it('brings a Date back as a Date, nested or not', () => {
    const anchor = new Date(2026, 9, 1, 12, 0, 0);
    const entries: [string, unknown][] = [
      ['anchor', anchor],
      ['deep', { when: anchor, list: [anchor] }],
      ['prompt', 'abro a las 6'],
      ['result', null],
    ];
    const back = new Map(decodeDraft(encodeDraft(entries)) ?? []);
    expect(back.get('anchor')).toBeInstanceOf(Date);
    expect((back.get('anchor') as Date).getTime()).toBe(anchor.getTime());
    const deep = back.get('deep') as { when: Date; list: Date[] };
    expect(deep.when.getTime()).toBe(anchor.getTime());
    expect(deep.list[0].getTime()).toBe(anchor.getTime());
    expect(back.get('prompt')).toBe('abro a las 6');
    expect(back.get('result')).toBeNull();
  });

  it('refuses text it cannot read, and drafts of another version', () => {
    expect(decodeDraft(null)).toBeNull();
    expect(decodeDraft('{not json')).toBeNull();
    expect(decodeDraft(JSON.stringify({ version: 999, entries: [] }))).toBeNull();
    expect(decodeDraft(JSON.stringify({ version: 1, entries: 'no' }))).toBeNull();
  });
});

describe('writeDraft', () => {
  function storageOfSize(max: number) {
    const data = new Map<string, string>();
    return {
      data,
      setItem(k: string, v: string) {
        if (v.length > max) throw new Error('QuotaExceededError');
        data.set(k, v);
      },
    };
  }

  it('writes everything when it fits', () => {
    const s = storageOfSize(10_000);
    const draft = new Map<string, unknown>([['prompt', 'x'], ['history', [1, 2, 3]]]);
    expect(writeDraft(s, 'k', draft)).toBe('full');
    expect(new Map(decodeDraft(s.data.get('k')!)!).get('history')).toEqual([1, 2, 3]);
  });

  it('drops history, and only history, when the draft is too big', () => {
    const s = storageOfSize(300);
    const draft = new Map<string, unknown>([
      ['prompt', 'x'],
      ['history', Array.from({ length: 50 }, (_, i) => ({ step: i }))],
    ]);
    expect(writeDraft(s, 'k', draft)).toBe('without-history');
    const back = new Map(decodeDraft(s.data.get('k')!)!);
    expect(back.get('prompt')).toBe('x');
    expect(back.has('history')).toBe(false);
  });

  it('reports a failure when even the trimmed draft is refused', () => {
    const s = storageOfSize(0);
    expect(writeDraft(s, 'k', new Map([['prompt', 'x']]))).toBe('failed');
  });
});
