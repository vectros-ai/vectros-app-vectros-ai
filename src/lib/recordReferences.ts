// ---------------------------------------------------------------------------
// Reference-field helpers — the pure logic behind the record detail view's
// relationship cross-links ("Relationships"). A `reference`
// field is a foreign key: it points at another record TYPE
// (`targetTypeName`) and resolves against that type's lookup field
// (`targetField`, default `externalId`). `cardinality` is 'one' (a single id)
// or 'many' (an array). The detail view resolves each stored value through the
// `lookupRecords` API to get the target record's id, then links to its detail.
//
// Kept framework-free so the field selection + value normalization are unit
// testable; the React `<ReferenceLink>` component consumes these.
// ---------------------------------------------------------------------------

import type { Vectros } from '../api/vectrosApi';
import { fieldLabel } from './recordForm';
import type { RenderHints } from './recordForm';

type FieldDef = Vectros.FieldDef;

/**
 * The `reference` field type discriminant — the value of the SDK enum constant
 * `Vectros.FieldDef.FieldType.Reference`. Kept as the literal so
 * this pure module needs only a type-only SDK import (no runtime namespace
 * dependency), and `FieldType` being a `const`-object union guarantees the
 * literal stays in sync at compile time.
 */
const REFERENCE_FIELD_TYPE: FieldDef['fieldType'] = 'reference';

/**
 * The lookup field a reference resolves against when the schema leaves
 * `targetField` unset — the target's stable external identifier.
 */
export const DEFAULT_REFERENCE_TARGET_FIELD = 'externalId';

/** A resolved reference field: everything the cross-link needs to query + link. */
export interface ReferenceField {
  readonly fieldId: string;
  readonly label: string;
  /** The record type the reference points at. */
  readonly targetTypeName: string;
  /** The target's unique lookup field the stored value matches against. */
  readonly targetField: string;
  /** 'one' = a single id; 'many' = an array of ids. */
  readonly cardinality: 'one' | 'many';
}

/** Non-empty trimmed string, else undefined. */
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The schema's reference fields, in declared order, that carry enough to build a
 * cross-link (`fieldType === 'reference'` with a `targetTypeName`). A reference
 * missing its target is skipped — it can't be resolved, so it stays in the raw
 * payload view rather than rendering a dead link.
 */
export function deriveReferenceFields(
  fields: ReadonlyArray<FieldDef>,
  hints?: RenderHints,
): ReferenceField[] {
  return fields
    .filter(
      (f) => f.fieldType === REFERENCE_FIELD_TYPE && nonEmpty(f.targetTypeName) !== undefined,
    )
    .map((f) => ({
      fieldId: f.fieldId,
      label: fieldLabel(f, hints),
      targetTypeName: nonEmpty(f.targetTypeName) as string,
      targetField: nonEmpty(f.targetField) ?? DEFAULT_REFERENCE_TARGET_FIELD,
      cardinality: f.cardinality === 'many' ? 'many' : 'one',
    }));
}

/**
 * Normalize a payload reference value to the list of target lookup values.
 * Tolerates either runtime shape (an array on a 'one' field, or a scalar on a
 * 'many' field), since payloads are non-strict. Blanks (undefined/null/'') are
 * dropped; everything else is stringified for the lookup query.
 */
export function referenceValues(value: unknown): string[] {
  const arr =
    value === undefined || value === null || value === ''
      ? []
      : Array.isArray(value)
        ? value
        : [value];
  return arr
    .filter((v) => v !== undefined && v !== null && v !== '')
    .map((v) => String(v));
}
