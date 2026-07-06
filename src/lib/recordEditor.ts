// ---------------------------------------------------------------------------
// Record-editor helpers — payload parsing, kept pure (no React, no SDK class
// imports) so they're unit-testable in isolation and reused by both the
// raw-JSON editor and the schema-driven form view.
//
// Optimistic-concurrency detection now lives in the generic `apiError` module
// (it applies to documents too) and is re-exported here for the record editor's
// existing call sites.
// ---------------------------------------------------------------------------

export { isVersionConflict } from './apiError';

/**
 * Result of parsing the raw-JSON payload editor. On failure the `kind`
 * discriminates the reason so the page can pick an i18n message — the prose
 * stays out of this pure module. `detail` carries the JS engine's parse
 * message for the `syntax` case (inherently English, shown as a hint).
 */
export type PayloadParseResult =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly kind: 'syntax'; readonly detail: string }
  | { readonly ok: false; readonly kind: 'notObject' };

/**
 * Parse the editor text into a record payload object. An empty/whitespace
 * string is treated as the empty payload `{}` (a record with no fields).
 * The payload MUST be a JSON object — arrays and primitives are rejected, since
 * a record body is a keyed object validated against its schema.
 */
export function parseRecordPayload(text: string): PayloadParseResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return { ok: false, kind: 'syntax', detail: err instanceof Error ? err.message : String(err) };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, kind: 'notObject' };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

/** Pretty-print a record payload for the editor; absent payload → `{}`. */
export function formatRecordPayload(payload: Record<string, unknown> | undefined): string {
  return JSON.stringify(payload ?? {}, null, 2);
}
