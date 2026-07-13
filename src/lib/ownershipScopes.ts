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
    if (entry.value.trim() === '') return { code: 'value', index: i };
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
 * Validate a single ownership filter string (`namespace:value`). Both halves are
 * checked: the namespace against the grammar, and the value for non-emptiness
 * and no embedded whitespace (so a half-typed `org:abc def` never fires a doomed
 * request).
 */
export function validateScopeFilter(raw: string): ScopeNamespaceError | null {
  const entry = parseScopeEntry(raw);
  if (!entry) return { code: 'grammar' };
  if (entry.value.trim() === '' || /\s/.test(entry.value)) return { code: 'grammar' };
  return validateScopeNamespace(entry.namespace);
}
