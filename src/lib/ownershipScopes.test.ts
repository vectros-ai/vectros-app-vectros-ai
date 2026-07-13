// ---------------------------------------------------------------------------
// ownershipScopes — build / parse / validate the `scopes` ownership model.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  buildScopes,
  formatScopeEntry,
  parseScopeEntry,
  validateScopeEntries,
  validateScopeFilter,
} from './ownershipScopes';

describe('formatScopeEntry / parseScopeEntry', () => {
  it('round-trips a namespace:value entry', () => {
    expect(formatScopeEntry({ namespace: 'group', value: 'eng-team' })).toBe(
      'group:eng-team',
    );
    expect(parseScopeEntry('group:eng-team')).toEqual({
      namespace: 'group',
      value: 'eng-team',
    });
  });

  it('splits on the FIRST colon (values may, defensively, contain one)', () => {
    expect(parseScopeEntry('org:a:b')).toEqual({ namespace: 'org', value: 'a:b' });
  });

  it('returns null when a half is missing', () => {
    expect(parseScopeEntry('group')).toBeNull();
    expect(parseScopeEntry(':x')).toBeNull();
    expect(parseScopeEntry('group:')).toBeNull();
  });
});

describe('buildScopes', () => {
  it('inherit → undefined (omit the field)', () => {
    expect(buildScopes('inherit', [])).toBeUndefined();
  });

  it('private → [] (empty array is sent, not omitted)', () => {
    expect(buildScopes('private', [{ namespace: 'group', value: 'x' }])).toEqual([]);
  });

  it('custom → formatted entries, blanks dropped', () => {
    expect(
      buildScopes('custom', [
        { namespace: 'org', value: 'org_1' },
        { namespace: '', value: '' },
        { namespace: 'group', value: 'eng' },
      ]),
    ).toEqual(['org:org_1', 'group:eng']);
  });
});

describe('validateScopeEntries', () => {
  it('rejects an all-blank custom selection as empty', () => {
    expect(validateScopeEntries([{ namespace: '', value: '' }])).toEqual({
      code: 'empty',
    });
  });

  it('rejects a reserved namespace', () => {
    expect(validateScopeEntries([{ namespace: 'tenant', value: 'x' }])).toEqual({
      code: 'namespace',
      index: 0,
      error: { code: 'reserved', namespace: 'tenant' },
    });
  });

  it('requires a value', () => {
    expect(validateScopeEntries([{ namespace: 'group', value: '' }])).toEqual({
      code: 'value',
      index: 0,
    });
  });

  it('rejects a duplicate namespace', () => {
    expect(
      validateScopeEntries([
        { namespace: 'org', value: 'a' },
        { namespace: 'org', value: 'b' },
      ]),
    ).toEqual({ code: 'duplicate', index: 1, namespace: 'org' });
  });

  it('rejects more than two entries', () => {
    expect(
      validateScopeEntries([
        { namespace: 'org', value: 'a' },
        { namespace: 'client', value: 'b' },
        { namespace: 'group', value: 'c' },
      ]),
    ).toEqual({ code: 'tooMany', max: 2 });
  });

  it('accepts one or two well-formed entries', () => {
    expect(
      validateScopeEntries([
        { namespace: 'org', value: 'org_1' },
        { namespace: 'group', value: 'eng' },
      ]),
    ).toBeNull();
  });
});

describe('validateScopeFilter', () => {
  it('accepts a well-formed filter', () => {
    expect(validateScopeFilter('group:eng-team')).toBeNull();
  });

  it('rejects a malformed or reserved filter', () => {
    expect(validateScopeFilter('group')?.code).toBe('grammar');
    expect(validateScopeFilter('tenant:x')?.code).toBe('reserved');
  });

  it('rejects a value with embedded whitespace (would fire a doomed request)', () => {
    expect(validateScopeFilter('org:abc def')?.code).toBe('grammar');
    expect(validateScopeFilter('org:   ')?.code).toBe('grammar');
  });
});
