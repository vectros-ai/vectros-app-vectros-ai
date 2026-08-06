// ---------------------------------------------------------------------------
// lookupFieldLabel tests — plain fields, composites, and the fixture that
// keeps them apart (a real composite sets fieldNames and NOT fieldName).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { lookupFieldLabel } from './lookupFieldLabel';

describe('lookupFieldLabel', () => {
  it('renders a plain lookup field by its fieldName', () => {
    expect(lookupFieldLabel({ fieldName: 'status' })).toBe('status');
  });

  it('renders a composite lookup (no fieldName) as its legs joined by comma', () => {
    // A real composite: fieldNames is set, fieldName is absent — a fixture
    // that also sets fieldName would pass even with the join logic missing.
    expect(lookupFieldLabel({ fieldNames: ['status', 'area'] })).toBe('status,area');
  });

  it('preserves declaration order for a 3-leg composite', () => {
    expect(lookupFieldLabel({ fieldNames: ['a', 'b', 'c'] })).toBe('a,b,c');
  });

  it('prefers fieldName when both are present (should not happen, but fieldName wins)', () => {
    expect(lookupFieldLabel({ fieldName: 'status', fieldNames: ['status', 'area'] })).toBe(
      'status',
    );
  });

  it('falls back to empty string when neither is set', () => {
    expect(lookupFieldLabel({})).toBe('');
  });
});
