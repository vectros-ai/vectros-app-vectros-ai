// ---------------------------------------------------------------------------
// scopeNamespace — grammar + validation for custom ownership-scope namespaces.
//
// An owned item carries its owning user plus up to two namespaced scope values,
// written as `namespace:value` entries (for example `org:6ba7b810-…` or
// `group:eng-team`). A namespace is 2–32 chars, a lowercase letter first, then
// lowercase letters, digits, `_` or `-`. `org` and `client` are the two
// built-in namespaces; `user`, `self`, `tenant`, `context`, and `scope` are
// reserved and rejected.
//
// Pure (no React) so the scope controls, filters, and tests validate the exact
// same shape the platform enforces.
// ---------------------------------------------------------------------------

/** A namespace is a lowercase letter followed by 1–31 of `[a-z0-9_-]` (2–32 total). */
export const SCOPE_NAMESPACE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;

/** The two built-in namespaces. */
export const SCOPE_BUILTIN_NAMESPACES = ['org', 'client'] as const;

/** Reserved namespaces the platform rejects. */
export const SCOPE_RESERVED_NAMESPACES = [
  'user',
  'self',
  'tenant',
  'context',
  'scope',
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
 * Returns null when valid; `org` / `client` are valid (built-ins).
 */
export function validateScopeNamespace(
  namespace: string,
): ScopeNamespaceError | null {
  const ns = namespace.trim();
  if (ns === '') return { code: 'empty' };
  if ((SCOPE_RESERVED_NAMESPACES as readonly string[]).includes(ns)) {
    return { code: 'reserved', namespace: ns };
  }
  if (!SCOPE_NAMESPACE_PATTERN.test(ns)) return { code: 'grammar' };
  return null;
}
