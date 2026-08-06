// ---------------------------------------------------------------------------
// lookupFieldLabel — the one place that renders a lookup field's declared
// identity, whether it's a plain field or a composite.
//
// The SDK's `LookupDef.fieldName` is optional: a composite lookup (one
// declared over more than one field) carries no `fieldName` at all, only an
// ordered `fieldNames[]` of its member fields. A composite's declared
// identity is those field names joined with `,` in declaration order —
// `field=status,area` is the API's own query spelling, and it's also the
// only string a composite can be usefully rendered as. Every call site that
// shows a lookup field's name must agree on this, or a composite renders as
// a blank row instead of its identity (React renders an absent `fieldName`
// as nothing, not the literal text "undefined").
// ---------------------------------------------------------------------------

/** The subset of `LookupDef` this helper needs — a plain field or a composite. */
export interface LookupFieldNameSource {
  readonly fieldName?: string | undefined;
  readonly fieldNames?: readonly string[] | undefined;
}

/**
 * The declared identity of a lookup field: `fieldName` when present,
 * otherwise its composite legs joined with `,` (the documented `field=a,b`
 * wire spelling). Empty string if neither is set — defensive only, since the
 * API always sends one or the other.
 */
export function lookupFieldLabel(l: LookupFieldNameSource): string {
  return l.fieldName ?? l.fieldNames?.join(',') ?? '';
}
