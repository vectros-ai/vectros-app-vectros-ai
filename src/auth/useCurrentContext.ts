// ---------------------------------------------------------------------------
// useCurrentContext — current-AppContext state for app.vectros.ai.
//
// "Current context" is the data-plane analogue of admin-app's "current tenant":
// the AppContext every records/schemas/folders/documents/search/inference call
// is implicitly scoped to. Critically, the context is NOT a request
// parameter — it's the `context_id` claim baked into the `st_*` token. So
// switching context = swapping the token (clear the bearer cache → next mint
// targets the new context → refetch), which is what CurrentContextProvider does.
//
// **No-provider fallback:** for test ergonomics + render helpers that don't wrap
// CurrentContextProvider, the hook returns inert defaults (no active context,
// empty list, no-op setContext). Data pages must treat `context === null` as
// "not ready" and gate their reads on it (or use useActiveContextId, which
// throws — the loud guard for rendering a data page outside the gate).
//
// File-split convention: the Provider component lives in
// ./CurrentContextProvider.tsx (matches the @vectros-ai/react CurrentTenant
// Provider / useCurrentTenant split).
// ---------------------------------------------------------------------------

import { createContext, useContext } from 'react';

import type { TenantId } from '@vectros-ai/react';

/**
 * One selectable AppContext in the switcher. The data plane spans tenants (a
 * user reaches the `default` context in BOTH their live and test tenants), so an
 * option is a `(tenant, context)` pair — `tenantId` is which tenant it lives in
 * and `tenantKind` labels it (Live/Test) so the user can tell them apart.
 */
export interface AppContextOption {
  /** The context identifier (the `context_id` token claim). */
  readonly contextId: string;
  /** Human-readable context label (falls back to the contextId). */
  readonly name: string;
  /** The tenant this context lives in — the mint targets `(tenantId, contextId)`. */
  readonly tenantId: TenantId;
  /** The tenant's kind, for the switcher label (Live vs Test). */
  readonly tenantKind: 'live' | 'test';
}

/** The context value exposed to consumers. */
export interface CurrentContextValue {
  /** The active contextId, or null while contexts load / when none are reachable. */
  readonly context: string | null;
  /**
   * The tenant the active context lives in, or null when none is selected. The
   * data-plane analogue of the active tenant — data calls mint/scope to THIS
   * tenant (not the shared `active_tenant` claim), since the active context may
   * live in either the live or test tenant.
   */
  readonly activeTenantId: TenantId | null;
  /**
   * Switch the active context: drops the partner-API bearer cache (so the next
   * call mints a token scoped to the new `(tenant, context)`) and refetches
   * context-scoped data. Async. No server-side persistence — context is
   * token-derived, not a stored preference. Takes the full option (not a bare
   * contextId) because the same contextId (e.g. `default`) exists in more than
   * one tenant.
   */
  readonly setContext: (option: AppContextOption) => Promise<void>;
  /** The AppContexts the signed-in user can reach, across their tenants (empty while loading / when none). */
  readonly contexts: ReadonlyArray<AppContextOption>;
  /** True during the initial context enumeration. */
  readonly loading: boolean;
  /** True when enumeration failed (the page surfaces an unavailable state). */
  readonly error: boolean;
  /** True while a context switch is in flight (token re-mint + refetch). */
  readonly switching: boolean;
}

export const CurrentContextContext = createContext<CurrentContextValue | null>(null);

/**
 * Read the current context + the reachable list + the setter.
 *
 * **No-provider fallback:** returns inert defaults when called outside a
 * provider. Consumers must gate context-scoped reads on `context !== null`.
 */
export function useCurrentContext(): CurrentContextValue {
  const ctx = useContext(CurrentContextContext);
  if (ctx) return ctx;
  return {
    context: null,
    activeTenantId: null,
    setContext: async () => undefined,
    contexts: [],
    loading: false,
    error: false,
    switching: false,
  };
}

/**
 * The active contextId, guaranteed non-null — for context-scoped data pages.
 *
 * Such pages render behind the shell's context gate, which doesn't mount the
 * routed page until a context is resolved. Throwing on null is a loud guard
 * against rendering a data page outside that gate (a wiring bug) — far better
 * than silently minting a token for a null context.
 */
export function useActiveContextId(): string {
  const { context } = useCurrentContext();
  if (context == null) {
    throw new Error(
      'useActiveContextId: no active context. Context-scoped pages must render ' +
        'inside the context gate (or, in tests, a CurrentContextProvider seeded ' +
        'with initialContext).',
    );
  }
  return context;
}

/**
 * The active context's tenant, guaranteed non-null — the data-plane tenant for
 * context-scoped reads/writes.
 *
 * This intentionally **overrides** `@vectros-ai/react`'s `useActiveTenantId`
 * (the global `active_tenant` claim, control-plane semantics) for app.vectros.ai:
 * the data plane spans tenants, so "the tenant for my data calls" is the tenant
 * of the *selected context*, not a single global one. Data pages keep calling
 * `useActiveTenantId()` + `useActiveContextId()` unchanged — they just resolve
 * the `(tenant, context)` pair the mint already accepts. Throws if no context is
 * active, matching `useActiveContextId`'s loud out-of-gate guard.
 */
export function useActiveTenantId(): TenantId {
  const { activeTenantId } = useCurrentContext();
  if (activeTenantId == null) {
    throw new Error(
      'useActiveTenantId: no active context tenant. Context-scoped pages must ' +
        'render inside the context gate (or, in tests, a CurrentContextProvider ' +
        'seeded with initialContext + initialTenant).',
    );
  }
  return activeTenantId;
}
