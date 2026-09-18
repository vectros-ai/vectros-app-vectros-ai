// ---------------------------------------------------------------------------
// scopeNamespace — grammar + validation for custom ownership-scope namespaces.
//
// An owned item carries its owning user plus up to two namespaced scope values,
// written as `namespace:value` entries (for example `org:6ba7b810-…` or
// `group:eng-team`). A namespace is 2–32 chars, a lowercase letter first, then
// lowercase letters, digits, `_` or `-`. `org` and `client` are NOT built-ins
// — they are ordinary namespaces, validated by the exact same grammar as any
// other; `user`, `self`, `tenant`, `context`, and `scope` are reserved and
// rejected.
//
// Pure (no React) so the scope controls, filters, and tests validate the exact
// same shape the platform enforces.
// ---------------------------------------------------------------------------

/** A namespace is a lowercase letter followed by 1–31 of `[a-z0-9_-]` (2–32 total). */
export const SCOPE_NAMESPACE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;

/**
 * Namespaces the platform refuses, mirrored from its own forbidden set.
 *
 * Two families, and both are permanent rather than stylistic. `record`,
 * `document`, `entity` and `user` are SURFACE names: a schema reference's
 * target is resolved as a fixed surface before it is resolved as a namespace,
 * so a namespace sharing a surface's name would be permanently shadowed and
 * references to it would silently resolve against the wrong plane. `versions`
 * and `lookup` are entity sub-path route segments, forbidden so those routes
 * cannot misroute. `self`, `tenant`, `context` and `scope` are grammar words.
 *
 * This list exists so a doomed value is refused in the box instead of at the
 * server, which is the whole point of this module — so it must stay complete.
 * It had drifted to only the four grammar words plus `user`, leaving
 * `document:acme` and friends to validate cleanly and then 400.
 */
export const SCOPE_RESERVED_NAMESPACES = [
  'user',
  'record',
  'document',
  'entity',
  'self',
  'tenant',
  'context',
  'scope',
  'versions',
  'lookup',
] as const;

/** An owned item may carry at most this many scope namespaces. */
export const MAX_SCOPE_NAMESPACES = 2;

/** Structured namespace-validation error. */
export type ScopeNamespaceError =
  | { readonly code: 'empty' }
  | { readonly code: 'grammar' }
  | { readonly code: 'reserved'; readonly namespace: string };

/**
 * Validate a single namespace against the platform grammar + reserved list.
 * Returns null when valid; `org` and `client` validate like any other
 * namespace name — they are ordinary registrations, not built-ins.
 */
export function validateScopeNamespace(namespace: string): ScopeNamespaceError | null {
  const ns = namespace.trim();
  if (ns === '') return { code: 'empty' };
  if ((SCOPE_RESERVED_NAMESPACES as readonly string[]).includes(ns)) {
    return { code: 'reserved', namespace: ns };
  }
  if (!SCOPE_NAMESPACE_PATTERN.test(ns)) return { code: 'grammar' };
  return null;
}
