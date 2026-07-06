// ---------------------------------------------------------------------------
// formatBytes tests — the unit cascade + the absent/sub-KiB edge branches.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { formatBytes } from './formatBytes';

describe('formatBytes', () => {
  it('returns an em-dash for undefined', () => {
    expect(formatBytes(undefined)).toBe('—');
  });

  it('shows plain bytes below 1 KiB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('steps into KB at 1024', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('steps up through MB / GB / TB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB');
  });

  it('caps the unit at TB for very large values', () => {
    // 1 PiB has no unit above TB → stays in TB (1024 TB).
    expect(formatBytes(1024 ** 5)).toBe('1024.0 TB');
  });
});
