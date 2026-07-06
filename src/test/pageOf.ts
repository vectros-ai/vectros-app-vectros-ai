// ---------------------------------------------------------------------------
// pageOf — test helper that wraps a fixture array in the `{ data,
// nextCursor }` page envelope. The auth enumeration endpoints (listAppContexts,
// listProfilesForPrincipal) and the record lookup (lookupRecords) return this
// envelope rather than a bare array. `nextCursor: null` marks a single, final
// page — what every fixture wants. Keeps the mocks faithful to the SDK shape so
// the `.data` unwrap / drainPages paths are actually exercised.
// ---------------------------------------------------------------------------

export function pageOf<T>(data: readonly T[]): {
  data: readonly T[];
  nextCursor: null;
} {
  return { data, nextCursor: null };
}
