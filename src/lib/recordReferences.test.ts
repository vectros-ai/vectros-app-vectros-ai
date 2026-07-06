// ---------------------------------------------------------------------------
// recordReferences tests — reference-field selection + value normalization
// (the pure logic behind the detail view's relationship cross-links).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REFERENCE_TARGET_FIELD,
  deriveReferenceFields,
  referenceValues,
} from './recordReferences';
import type { RenderHints } from './recordForm';
import type { Vectros } from '../api/vectrosApi';

type FieldDef = Vectros.FieldDef;

const field = (fieldId: string, fieldType: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  fieldId,
  fieldType: fieldType as FieldDef['fieldType'],
  ...extra,
});

describe('deriveReferenceFields', () => {
  it('selects only reference fields that carry a target record type, in declared order', () => {
    const fields = [
      field('name', 'string'),
      field('manager', 'reference', { targetTypeName: 'employee', targetField: 'employeeId' }),
      field('age', 'number'),
      field('orgUnit', 'reference', { targetTypeName: 'org_unit' }),
      // A reference missing its target can't be linked → skipped.
      field('broken', 'reference'),
    ];
    const result = deriveReferenceFields(fields);
    expect(result.map((r) => r.fieldId)).toEqual(['manager', 'orgUnit']);
  });

  it('labels via renderHints, falling back to fieldId', () => {
    const fields = [field('manager', 'reference', { targetTypeName: 'employee' })];
    const hints: RenderHints = { manager: { label: 'Reports to' } };
    expect(deriveReferenceFields(fields, hints)[0]?.label).toBe('Reports to');
    expect(deriveReferenceFields(fields)[0]?.label).toBe('manager');
  });

  it('defaults targetField to externalId and cardinality to one', () => {
    const fields = [field('orgUnit', 'reference', { targetTypeName: 'org_unit' })];
    const rf = deriveReferenceFields(fields)[0];
    expect(rf?.targetField).toBe(DEFAULT_REFERENCE_TARGET_FIELD);
    expect(rf?.targetField).toBe('externalId');
    expect(rf?.cardinality).toBe('one');
  });

  it('honors an explicit targetField and cardinality=many', () => {
    const fields = [
      field('tags', 'reference', {
        targetTypeName: 'tag',
        targetField: 'slug',
        cardinality: 'many',
      }),
    ];
    const rf = deriveReferenceFields(fields)[0];
    expect(rf).toMatchObject({ targetField: 'slug', cardinality: 'many' });
  });

  it('treats a blank/whitespace targetTypeName as missing (skipped)', () => {
    const fields = [field('x', 'reference', { targetTypeName: '   ' })];
    expect(deriveReferenceFields(fields)).toEqual([]);
  });
});

describe('referenceValues', () => {
  it('normalizes a scalar to a single-value list', () => {
    expect(referenceValues('emp_1')).toEqual(['emp_1']);
    expect(referenceValues(42)).toEqual(['42']);
  });

  it('normalizes an array, dropping blanks', () => {
    expect(referenceValues(['a', '', 'b', null, undefined, 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty list for blank/absent values', () => {
    expect(referenceValues(undefined)).toEqual([]);
    expect(referenceValues(null)).toEqual([]);
    expect(referenceValues('')).toEqual([]);
    expect(referenceValues([])).toEqual([]);
  });

  it('tolerates shape mismatches (array on a one-field, scalar on a many-field)', () => {
    expect(referenceValues(['only'])).toEqual(['only']);
    expect(referenceValues('solo')).toEqual(['solo']);
  });
});
