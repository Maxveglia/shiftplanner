import { describe, expect, it } from 'vitest';
import { renameTo } from './rename';

describe('renameTo', () => {
  it('saves a name that actually changed', () => {
    expect(renameTo('Ana Ruiz', 'Ana Ruíz')).toBe('Ana Ruiz');
  });

  it('saves nothing when the name came back the same', () => {
    expect(renameTo('Ana Ruiz', 'Ana Ruiz')).toBeNull();
  });

  it('treats a blank box as a change of mind, not as a blank name', () => {
    expect(renameTo('', 'Ana Ruiz')).toBeNull();
    expect(renameTo('   ', 'Ana Ruiz')).toBeNull();
  });

  it('drops the whitespace a paste brings with it', () => {
    expect(renameTo('  Ana Ruiz ', 'Ana Ruiz')).toBeNull();
    expect(renameTo('Ana   Ruiz', 'Ana Ruiz')).toBeNull();
    expect(renameTo(' Ana  Ruiz ', 'Ana Ruíz')).toBe('Ana Ruiz');
  });
});
