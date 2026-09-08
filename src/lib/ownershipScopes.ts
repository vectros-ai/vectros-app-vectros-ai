// ---------------------------------------------------------------------------
// ownershipScopes — read/write model for an item's `scopes` ownership.
//
// A record / document / folder carries its owning user plus up to two
// `namespace:value` scope entries (`org:<uuid>`, `client:<uuid>`, or a custom
// `group:eng-team`). On create:
//   - omit `scopes`  → inherit the token's full identity (today's default),
//   - `scopes: []`   → private, owned by the calling user alone,
//   - `scopes: [..]` → an explicit ownership, whose values must match the
//                      token's identity (the platform rejects a mismatch).
// Read back, `scopes` is the item's canonical `namespace:value` list.
//
// Pure so the create control, the ownership filter, and tests share one
// implementation of the entry grammar.
// ---------------------------------------------------------------------------

import {
  MAX_SCOPE_NAMESPACES,
  validateScopeNamespace,
} from './scopeNamespace';
import type { ScopeNamespaceError } from './scopeNamespace';

/** One `namespace:value` ownership entry. */
export interface ScopeEntry {
  readonly namespace: string;
  readonly value: string;
}

/** How create-time ownership is chosen. */
export type OwnershipMode = 'inherit' | 'private' | 'custom';

/** Serialize an entry to its `namespace:value` wire form. */
export function formatScopeEntry(entry: ScopeEntry): string {
  return `${entry.namespace.trim()}:${entry.value.trim()}`;
}

/**
 * Parse a `namespace:value` string into an entry, splitting on the FIRST colon
 * (values never contain one, but be defensive). Returns null when either half
 * is empty.
 */
export function parseScopeEntry(raw: string): ScopeEntry | null {
  const s = raw.trim();
  const idx = s.indexOf(':');
  if (idx <= 0) return null;
  const namespace = s.slice(0, idx);
  const value = s.slice(idx + 1);
  if (value.trim() === '') return null;
  return { namespace, value };
}

/** True when an entry row has been started (either half filled in). */
function isActiveEntry(entry: ScopeEntry): boolean {
  return entry.namespace.trim() !== '' || entry.value.trim() !== '';
}

/**
 * Build the wire `scopes` value from the chosen mode + custom entries.
 * `inherit` → `undefined` (omit the field); `private` → `[]`; `custom` → the
 * formatted entries (blank rows dropped).
 */
export function buildScopes(
  mode: OwnershipMode,
  entries: readonly ScopeEntry[],
): string[] | undefined {
  if (mode === 'inherit') return undefined;
  if (mode === 'private') return [];
  return entries
    .filter(isActiveEntry)
    .filter((e) => e.namespace.trim() !== '' && e.value.trim() !== '')
    .map(formatScopeEntry);
}

/** Structured validation error for the custom-entries editor. */
export type ScopeEntriesError =
  | { readonly code: 'tooMany'; readonly max: number }
  | {
      readonly code: 'namespace';
      readonly index: number;
      readonly error: ScopeNamespaceError;
    }
  | { readonly code: 'value'; readonly index: number }
  | { readonly code: 'duplicate'; readonly index: number; readonly namespace: string }
  | { readonly code: 'empty' };

/**
 * Validate the custom entries. Returns null when savable. A fully-blank row is
 * ignored; a started row needs a valid namespace and a value; namespaces must
 * be unique; at most {@link MAX_SCOPE_NAMESPACES} entries; and `custom` mode
 * with no completed entry at all is an `empty` error (pick Private instead).
 */
export function validateScopeEntries(
  entries: readonly ScopeEntry[],
): ScopeEntriesError | null {
  const seen = new Set<string>();
  let complete = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || !isActiveEntry(entry)) continue;
    const ns = entry.namespace.trim();
    const nsError = validateScopeNamespace(ns);
    if (nsError) return { code: 'namespace', index: i, error: nsError };
    // Same grammar the filter box applies, and the same one the API enforces — an entry the
    // server would refuse is flagged in the editor rather than on save. Tested against the trimmed
    // value because `buildScopes` formats from the trimmed entry, so this IS what gets sent (unlike
    // the filter path, where the raw string is sent and trimming here would under-report).
    if (!isValidScopeValue(entry.value.trim())) return { code: 'value', index: i };
    if (seen.has(ns)) return { code: 'duplicate', index: i, namespace: ns };
    seen.add(ns);
    complete += 1;
  }
  if (complete > MAX_SCOPE_NAMESPACES) {
    return { code: 'tooMany', max: MAX_SCOPE_NAMESPACES };
  }
  if (complete === 0) return { code: 'empty' };
  return null;
}

/**
 * The grammar a scope VALUE must satisfy: 1-128 characters, a letter or digit
 * first, then letters, digits, `_` or `-`. This mirrors the API's own rule — a
 * scope value becomes part of a storage key there, so the server rejects
 * anything outside this set. Keeping the check identical is what lets the editor
 * flag a bad value inline rather than sending a request that is certain to fail.
 */
const SCOPE_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** True when `value` satisfies the scope-value grammar the API enforces. */
export function isValidScopeValue(value: string): boolean {
  return SCOPE_VALUE_PATTERN.test(value);
}

/**
 * Validate a single ownership filter string (`namespace:value`). Both halves are
 * checked: the namespace against its grammar, and the value against
 * {@link SCOPE_VALUE_PATTERN}, so a half-typed `org:abc def` — or any value the
 * API would refuse — never fires a doomed request.
 *
 * The value is tested EXACTLY as it will be sent, without trimming. Trimming first
 * made this looser than the whitespace check it replaced: `org: 6ba7…` (a space
 * after the colon, an ordinary typing habit) validated clean and was then sent
 * untrimmed, producing the server rejection this function exists to pre-empt. If
 * surrounding whitespace should be tolerated, normalise it where the entry is
 * PARSED so the validated string and the sent string stay the same one.
 */
export function validateScopeFilter(raw: string): ScopeNamespaceError | null {
  const entry = parseScopeEntry(raw);
  if (!entry) return { code: 'grammar' };
  if (!isValidScopeValue(entry.value)) return { code: 'grammar' };
  return validateScopeNamespace(entry.namespace);
}

/**
 * The most `namespace:value` entries `/v1/search` and `/v1/rag` accept in one
 * `scopeFilters` array. Mirrors the API's own cap so an over-long filter is
 * flagged in the box rather than as a 400. NOTE this is a different limit from
 * {@link MAX_SCOPE_NAMESPACES}, which bounds how many scopes ONE ITEM may
 * carry — a query may narrow by more dimensions than a single item holds.
 */
export const MAX_SCOPE_FILTERS = 16;

/** Why a multi-dimension ownership filter string isn't usable. */
export type ScopeFiltersError =
  | { readonly code: 'entry'; readonly index: number; readonly raw: string }
  | { readonly code: 'duplicate'; readonly namespace: string }
  | { readonly code: 'tooMany'; readonly max: number };

/**
 * Split a comma-separated ownership filter into its trimmed entries, dropping
 * blank ones (so a trailing comma mid-typing isn't an error).
 *
 * Each entry is TRIMMED here, at the parse, and it is the trimmed entry that
 * both {@link validateScopeFilters} checks and {@link scopeFiltersParam} sends
 * — keeping the validated string and the sent string the same one, which is the
 * rule {@link validateScopeFilter} above documents the hard way.
 */
export function splitScopeFilters(raw: string): string[] {
  return raw
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e !== '');
}

/**
 * Validate a multi-dimension ownership filter (`org:<id>, client:<id>`).
 * Returns null when savable. Enforces exactly what the API does: every entry a
 * well-formed `namespace:value`, each namespace named at most once, and at most
 * {@link MAX_SCOPE_FILTERS} entries.
 */
export function validateScopeFilters(raw: string): ScopeFiltersError | null {
  const entries = splitScopeFilters(raw);
  const seen = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as string;
    if (validateScopeFilter(entry) !== null) return { code: 'entry', index: i, raw: entry };
    // Non-null: validateScopeFilter already accepted the grammar.
    const ns = (parseScopeEntry(entry) as ScopeEntry).namespace;
    if (seen.has(ns)) return { code: 'duplicate', namespace: ns };
    seen.add(ns);
  }
  if (entries.length > MAX_SCOPE_FILTERS) {
    return { code: 'tooMany', max: MAX_SCOPE_FILTERS };
  }
  return null;
}

/**
 * The validated entries for a multi-dimension filter, or undefined when the
 * filter is empty or not yet usable.
 *
 * The CALLER decides which wire field to use: `/v1/search` and `/v1/rag` treat
 * `scope` and `scopeFilters` as mutually exclusive (sending both is a 400), so
 * send `scope` for a single entry and `scopeFilters` for more than one.
 */
export function scopeFiltersParam(raw: string): string[] | undefined {
  if (validateScopeFilters(raw) !== null) return undefined;
  const entries = splitScopeFilters(raw);
  return entries.length > 0 ? entries : undefined;
}

/**
 * The ownership arguments for a `/v1/search` or `/v1/rag` request built from a
 * multi-dimension filter box: `{ scope }` for exactly one dimension,
 * `{ scopeFilters }` for more than one, and `{}` when the filter is empty or
 * not yet usable.
 *
 * The two fields are MUTUALLY EXCLUSIVE server-side — sending both is a 400 —
 * so choosing between them belongs in one place rather than at each call site.
 * Spread the result into the request; it never emits a key with an `undefined`
 * value, which `exactOptionalPropertyTypes` would reject.
 */
export function ownershipScopeQueryArgs(
  raw: string,
): { scope: string } | { scopeFilters: string[] } | Record<string, never> {
  const entries = scopeFiltersParam(raw);
  if (!entries || entries.length === 0) return {};
  if (entries.length === 1) return { scope: entries[0] as string };
  return { scopeFilters: entries };
}
