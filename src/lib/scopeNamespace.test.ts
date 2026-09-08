// ---------------------------------------------------------------------------
// scopeNamespace — namespace grammar + reserved-word validation.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { SCOPE_RESERVED_NAMESPACES, validateScopeNamespace } from './scopeNamespace';

describe('validateScopeNamespace', () => {
  it('accepts built-ins + well-formed custom namespaces', () => {
    for (const ns of ['org', 'client', 'group', 'eng-team', 'a1']) {
      expect(validateScopeNamespace(ns)).toBeNull();
    }
  });

  it('rejects empty, reserved, and grammar-violating namespaces', () => {
    expect(validateScopeNamespace('')).toEqual({ code: 'empty' });
    expect(validateScopeNamespace('scope')).toEqual({
      code: 'reserved',
      namespace: 'scope',
    });
    for (const ns of ['A', 'x', '1group', 'has space', 'a'.repeat(33)]) {
      expect(validateScopeNamespace(ns)?.code).toBe('grammar');
    }
  });

  // The whole point of this module is refusing a doomed value in the box rather
  // than at the server, so this list must mirror the platform's forbidden set
  // in full. It had drifted to five of the ten: the surface names
  // (record/document/entity) and the entity sub-path route segments
  // (versions/lookup) were missing, so `document:acme` validated clean and 400'd.
  it('rejects every namespace the platform forbids, not just the grammar words', () => {
    for (const ns of [
      'user',
      'record',
      'document',
      'entity',
      'self',
      'tenant',
      'context',
      'scope',
      'versions',
      'lookup',
    ]) {
      expect(validateScopeNamespace(ns)).toEqual({ code: 'reserved', namespace: ns });
      expect(SCOPE_RESERVED_NAMESPACES).toContain(ns);
    }
    expect(SCOPE_RESERVED_NAMESPACES).toHaveLength(10);
  });

  it('accepts the 2-char and 32-char boundaries', () => {
    expect(validateScopeNamespace('ab')).toBeNull();
    expect(validateScopeNamespace('a' + 'b'.repeat(31))).toBeNull();
    expect(validateScopeNamespace('a' + 'b'.repeat(32))?.code).toBe('grammar');
  });
});
