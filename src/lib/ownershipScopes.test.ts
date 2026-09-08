// ---------------------------------------------------------------------------
// ownershipScopes — build / parse / validate the `scopes` ownership model.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  buildScopes,
  formatScopeEntry,
  parseScopeEntry,
  MAX_SCOPE_FILTERS,
  ownershipScopeQueryArgs,
  scopeFiltersParam,
  splitScopeFilters,
  validateScopeEntries,
  validateScopeFilter,
  validateScopeFilters,
} from './ownershipScopes';

describe('formatScopeEntry / parseScopeEntry', () => {
  it('round-trips a namespace:value entry', () => {
    expect(formatScopeEntry({ namespace: 'group', value: 'eng-team' })).toBe('group:eng-team');
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

describe('validateScopeEntries — the value grammar in the custom-entries editor', () => {
  const entry = (namespace: string, value: string) => ({ namespace, value });

  it('rejects a value the API would reject', () => {
    // This function moved from a blank check to the full grammar; every pre-existing cell here uses a
    // clean value, so all of them passed identically before and after and none covered the change.
    for (const bad of ['a:b', 'has.dot', 'has space', '-leading', 'v'.repeat(129)]) {
      expect(validateScopeEntries([entry('org', bad)]), `expected '${bad}' to be flagged`).toEqual({
        code: 'value',
        index: 0,
      });
    }
  });

  it('reports the INDEX of the offending row, not just the first row', () => {
    expect(validateScopeEntries([entry('org', 'org_x'), entry('group', 'a:b')])).toEqual({
      code: 'value',
      index: 1,
    });
  });

  it('still accepts the shapes real values take', () => {
    expect(validateScopeEntries([entry('org', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')])).toBeNull();
    expect(
      validateScopeEntries([entry('group', 'eng-team'), entry('client', 'cli_IDN')]),
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

  it('applies the full value grammar, not just a whitespace check', () => {
    // The check used to be "non-empty and no whitespace", which was strictly looser than the API's
    // rule — so these all reached the server and came back as errors. A colon is the sharpest case:
    // a scope value becomes part of a storage key, so the API refuses one outright.
    expect(validateScopeFilter('org:a:b')?.code).toBe('grammar');
    expect(validateScopeFilter('org:has.dot')?.code).toBe('grammar');
    expect(validateScopeFilter('org:has#hash')?.code).toBe('grammar');
    expect(validateScopeFilter('org:-leading')?.code).toBe('grammar');
    expect(validateScopeFilter(`org:${'v'.repeat(129)}`)?.code).toBe('grammar');
  });

  it('flags a space after the colon — the value is tested exactly as it is SENT', () => {
    // Regression: an earlier version trimmed the value before testing it while `scopeFilterParam`
    // sent the untrimmed string, so this common typing habit validated clean and then 400'd at the
    // server — looser than the plain whitespace check it replaced, in the one function whose stated
    // job is to stop a doomed request from firing.
    expect(validateScopeFilter('org: 6ba7b810-9dad-11d1-80b4-00c04fd430c8')?.code).toBe('grammar');
    // Whitespace AROUND the whole string is a different case and stays accepted: `scopeFilterParam`
    // trims the string before both validating and sending, so the two agree. It is the space INSIDE
    // the value that no trim removes, and that is the one this cell guards.
    expect(validateScopeFilter('  org:6ba7b810  '.trim())).toBeNull();
  });

  it('still accepts the shapes real scope values take', () => {
    // Controls — without these the cell above would pass against a validator that rejects everything.
    expect(validateScopeFilter('org:6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBeNull();
    expect(validateScopeFilter('client:cli_IDN')).toBeNull();
    expect(validateScopeFilter(`group:${'v'.repeat(128)}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Multi-dimension ownership filters — `/v1/search` + `/v1/rag` `scopeFilters`.
// The rules mirror the API's own: every entry a well-formed `namespace:value`,
// each namespace at most once, at most MAX_SCOPE_FILTERS entries, and the array
// mutually exclusive with the singular `scope`.
// ---------------------------------------------------------------------------
describe('splitScopeFilters', () => {
  it('trims each entry and drops blanks, so a trailing comma is not an error', () => {
    expect(splitScopeFilters('org:acme, client:pilot')).toEqual(['org:acme', 'client:pilot']);
    expect(splitScopeFilters('org:acme,')).toEqual(['org:acme']);
    expect(splitScopeFilters('   ')).toEqual([]);
  });
});

describe('validateScopeFilters', () => {
  it('accepts one or several well-formed dimensions', () => {
    expect(validateScopeFilters('org:acme')).toBeNull();
    expect(validateScopeFilters('org:acme, client:pilot')).toBeNull();
    expect(validateScopeFilters('')).toBeNull();
  });

  it('rejects a malformed entry, naming which one', () => {
    expect(validateScopeFilters('org:acme, client')).toEqual({
      code: 'entry',
      index: 1,
      raw: 'client',
    });
  });

  it('rejects a namespace named twice — the API refuses the repeat', () => {
    expect(validateScopeFilters('org:a, org:b')).toEqual({ code: 'duplicate', namespace: 'org' });
  });

  it(`rejects more than ${MAX_SCOPE_FILTERS} entries`, () => {
    const tooMany = Array.from({ length: MAX_SCOPE_FILTERS + 1 }, (_, i) => `ns${i}:v`).join(',');
    expect(validateScopeFilters(tooMany)).toEqual({ code: 'tooMany', max: MAX_SCOPE_FILTERS });
    const atCap = Array.from({ length: MAX_SCOPE_FILTERS }, (_, i) => `ns${i}:v`).join(',');
    expect(validateScopeFilters(atCap)).toBeNull();
  });
});

describe('scopeFiltersParam / ownershipScopeQueryArgs', () => {
  it('sends nothing at all for an empty or unusable filter', () => {
    expect(scopeFiltersParam('')).toBeUndefined();
    expect(scopeFiltersParam('org:a, org:b')).toBeUndefined();
    expect(ownershipScopeQueryArgs('')).toEqual({});
    expect(ownershipScopeQueryArgs('nope')).toEqual({});
  });

  it('picks `scope` for one dimension and `scopeFilters` for more — never both', () => {
    // The two fields are mutually exclusive server-side; sending both is a 400.
    expect(ownershipScopeQueryArgs('org:acme')).toEqual({ scope: 'org:acme' });
    expect(ownershipScopeQueryArgs('org:acme, client:pilot')).toEqual({
      scopeFilters: ['org:acme', 'client:pilot'],
    });
    for (const raw of ['org:acme', 'org:acme, client:pilot']) {
      const keys = Object.keys(ownershipScopeQueryArgs(raw));
      expect(keys).toHaveLength(1);
    }
  });

  it('validates the entry it will actually SEND — whitespace around a comma is normalised', () => {
    // The trim happens at the split, so the validated string and the sent string
    // are the same one (the discipline `validateScopeFilter` documents).
    expect(ownershipScopeQueryArgs('  org:acme ,  client:pilot ')).toEqual({
      scopeFilters: ['org:acme', 'client:pilot'],
    });
    // A space INSIDE a value is still refused — no trim removes that one.
    expect(ownershipScopeQueryArgs('org:ac me, client:pilot')).toEqual({});
  });
});

describe('validateScopeFilters — edge cases the multi box actually receives', () => {
  it('applies the reserved-namespace rule to a list member, not just a lone entry', () => {
    // Delegation to validateScopeFilter is an implementation choice; this pins
    // the BEHAVIOUR, so replacing the delegation cannot quietly drop the rule.
    expect(validateScopeFilters('tenant:x, org:a')).toEqual({
      code: 'entry',
      index: 0,
      raw: 'tenant:x',
    });
  });

  it('rejects an entry missing either half', () => {
    expect(validateScopeFilters('org:a, :v')?.code).toBe('entry');
    expect(validateScopeFilters('org:a, client:')?.code).toBe('entry');
  });

  it('ignores interior and repeated blanks, not just a trailing comma', () => {
    expect(splitScopeFilters('org:a,,client:b')).toEqual(['org:a', 'client:b']);
    expect(validateScopeFilters('org:a,,client:b')).toBeNull();
    expect(splitScopeFilters(',,,')).toEqual([]);
    expect(validateScopeFilters(',,,')).toBeNull();
    expect(ownershipScopeQueryArgs(',,,')).toEqual({});
  });

  it('reports the duplicate ahead of the cap when a filter breaks both rules', () => {
    // The cap check runs after the per-entry loop, so a 17-entry list that also
    // repeats a namespace reports `duplicate`. Pinned because the message the
    // user sees for a doubly-broken filter should not drift silently.
    const entries = Array.from({ length: 16 }, (_, i) => `ns${i}:v`).concat('ns0:other');
    expect(validateScopeFilters(entries.join(','))).toEqual({
      code: 'duplicate',
      namespace: 'ns0',
    });
  });

  it('assembles the full array at exactly the cap', () => {
    const entries = Array.from({ length: MAX_SCOPE_FILTERS }, (_, i) => `ns${i}:v`);
    expect(ownershipScopeQueryArgs(entries.join(', '))).toEqual({ scopeFilters: entries });
  });
});
