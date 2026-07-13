// ---------------------------------------------------------------------------
// scopeNamespace — namespace grammar + reserved-word validation.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { validateScopeNamespace } from './scopeNamespace';

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

  it('accepts the 2-char and 32-char boundaries', () => {
    expect(validateScopeNamespace('ab')).toBeNull();
    expect(validateScopeNamespace('a' + 'b'.repeat(31))).toBeNull();
    expect(validateScopeNamespace('a' + 'b'.repeat(32))?.code).toBe('grammar');
  });
});
