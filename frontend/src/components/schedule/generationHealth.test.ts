// A job whose worker died says so, instead of looking hung.

import { describe, expect, it } from 'vitest';
import { healthNote } from './GenerationProgress';

describe('healthNote', () => {
  it('says nothing while the job is healthy', () => {
    expect(healthNote(undefined)).toBeNull();
    expect(healthNote({ stalled: false, resumed: false })).toBeNull();
  });

  it('explains a silence before it explains a resume', () => {
    // Stalled on its second attempt: the worker that took it up has died too,
    // and the one thing worth saying is that it is waiting.
    expect(healthNote({ stalled: true, resumed: true })).toBe('dashboard.generating.health.stalled');
  });

  it('says when a job was picked up again', () => {
    expect(healthNote({ stalled: false, resumed: true })).toBe('dashboard.generating.health.resumed');
  });
});
