// ---------------------------------------------------------------------------
// recordEditor helper tests — payload parsing + version-conflict detection.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { formatRecordPayload, isVersionConflict, parseRecordPayload } from './recordEditor';

describe('parseRecordPayload', () => {
  it('parses a JSON object', () => {
    const result = parseRecordPayload('{ "firstName": "Alice", "age": 30 }');
    expect(result).toEqual({ ok: true, value: { firstName: 'Alice', age: 30 } });
  });

  it('treats empty / whitespace-only text as the empty payload', () => {
    expect(parseRecordPayload('')).toEqual({ ok: true, value: {} });
    expect(parseRecordPayload('   \n  ')).toEqual({ ok: true, value: {} });
  });

  it('reports a syntax error with the engine detail', () => {
    const result = parseRecordPayload('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('syntax');
      if (result.kind === 'syntax') expect(result.detail).toBeTruthy();
    }
  });

  it('rejects arrays and primitives as not-an-object', () => {
    for (const text of ['[1, 2, 3]', '"a string"', '42', 'true', 'null']) {
      const result = parseRecordPayload(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe('notObject');
    }
  });
});

describe('formatRecordPayload', () => {
  it('pretty-prints a payload with 2-space indent', () => {
    expect(formatRecordPayload({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('renders an absent payload as the empty object', () => {
    expect(formatRecordPayload(undefined)).toBe('{}');
  });
});

describe('isVersionConflict', () => {
  it('is true for a 409-status error', () => {
    expect(isVersionConflict({ statusCode: 409 })).toBe(true);
    expect(isVersionConflict(Object.assign(new Error('conflict'), { statusCode: 409 }))).toBe(true);
  });

  it('is false for other statuses and non-error values', () => {
    expect(isVersionConflict({ statusCode: 400 })).toBe(false);
    expect(isVersionConflict(new Error('boom'))).toBe(false);
    expect(isVersionConflict(null)).toBe(false);
    expect(isVersionConflict('409')).toBe(false);
  });
});
