// ---------------------------------------------------------------------------
// Schema-surface filtering — one place for "which schemas define types on THIS
// surface?". A schema declares, via `allowedSurfaces`, which typed surfaces
// may bind it (record, document, user, org, client — always present, required
// at write time). The records explorer/editor must only offer record-surface
// types and the documents view only document-surface types; without the
// filter, a document-only type leaks into the records type picker (and vice
// versa) and every interaction with it 4xxs against the API.
//
// Kept framework-free so it is unit-testable in isolation.
// ---------------------------------------------------------------------------

import type { SchemaResponse } from '../api/vectrosApi';

/** A schema usable as a type on some surface (its `typeName` is present). */
export type TypedSchema = SchemaResponse & { typeName: string };

/**
 * The schemas that define types on `surface`: those with a `typeName` whose
 * `allowedSurfaces` includes it. Declared order is preserved.
 */
export function schemasForSurface(
  schemas: ReadonlyArray<SchemaResponse>,
  surface: 'record' | 'document',
): TypedSchema[] {
  return schemas.filter(
    (s): s is TypedSchema =>
      typeof s.typeName === 'string' &&
      (s.allowedSurfaces ?? []).some((declared) => declared === surface),
  );
}
