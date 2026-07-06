// ---------------------------------------------------------------------------
// CurrentContextProvider — owns the active-AppContext state + the context-switch
// orchestration for app.vectros.ai's data plane.
//
// Sits inside <AuthProvider> (needs useAuth, for getActivePartnerUserId),
// <CurrentTenantProvider> (needs the membership set + the caller's role), and
// <QueryClientProvider> (needs the query client to refetch on switch). See
// main.tsx for the nesting.
//
// Enumeration — the data plane SPANS TENANTS. A selectable option is a
// `(tenant, context)` pair, so the switcher can offer, e.g., the `default`
// context in BOTH the live and test tenant. The active selection carries its
// tenant (activeTenantId); data calls mint/scope to that tenant, NOT the shared
// `active_tenant` claim.
//   - OWNER:    every context in EACH tenant the user owns, except the reserved
//               control-plane context (`listAppContexts` per owned tenant minus
//               `vectros-admin`). Spans the owner's live + test tenants.
//   - SUB_USER: contexts where the caller holds an ACTIVE AccessProfile in the
//               ACTIVE tenant (`listProfilesForPrincipal`, minus reserved). The
//               principal is `usr_<partnerUserId>` from the active membership.
//               (Cross-tenant SUB_USER + cross-partner enumeration is a tracked
//               follow-up — the active_partner_user_id claim is per active tenant.)
//
// Switching is a TOKEN SWAP, not a query-param toggle: the `st_*` bearer carries
// the (tenant, context). setContext drops the bearer cache so the next mint
// targets the new pair, then invalidates queries so all data refetches.
//
// Security note: this enumeration is UI convenience only. The authoritative gate
// is the per-context mint, which performs the server-side access check and
// refuses to stamp a context the caller isn't entitled to. A wrong/over-broad
// list here can never grant access — the mint 404s.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Import the shared auth bits directly from the package (NOT via '../auth',
// which re-exports THIS module — that would be an import cycle).
import { useAuth, useCurrentTenant, clearVectrosApiTokenCache } from '@vectros-ai/react';
import type {
  AppContextSummary,
  ListAppContextsOptions,
  TenantId,
  TenantMembership,
} from '@vectros-ai/react';
import { vectrosApiClient } from '../api/vectrosApi';
import { drainPages } from '../lib/drainPages';
import { CurrentContextContext } from './useCurrentContext';
import type { AppContextOption, CurrentContextValue } from './useCurrentContext';

/**
 * The reserved control-plane context — hidden from the data-plane switcher (it
 * holds control-plane access-profiles, not data). Matches admin-app's constant
 * + the backend's ADMIN_CONTEXT_ID.
 */
const RESERVED_CONTROL_PLANE_CONTEXT_ID = 'vectros-admin';
/** The base data context, preferred as the initial selection when present. */
const DEFAULT_CONTEXT_ID = 'default';
/** Principal-id prefix for a human user (matches the backend's `usr_` convention). */
const PRINCIPAL_PREFIX_USER = 'usr_';
/** Page size for enumeration — the SDK's max (its default is only 20). */
const ENUMERATION_PAGE_SIZE = 100;
/** Safety ceiling on pages (100 × 50 = 5000 items) — guards a non-advancing cursor. */
const ENUMERATION_MAX_PAGES = 50;

/** Build a switcher option, falling back to the id when no display name exists. */
function toOption(
  contextId: string,
  tenant: Pick<TenantMembership, 'tenantId' | 'tenantKind'>,
  name?: string,
): AppContextOption {
  return {
    contextId,
    name: name && name.length > 0 ? name : contextId,
    tenantId: tenant.tenantId,
    tenantKind: tenant.tenantKind,
  };
}

/** The OWNER-gated context lister (developer API), surfaced via useAuth(). */
type AppContextLister = (
  tenantId: TenantId,
  options?: ListAppContextsOptions,
) => Promise<ReadonlyArray<AppContextSummary>>;

/**
 * OWNER enumeration for a SINGLE owned tenant. Uses the OWNER-gated developer-API
 * lister (NOT the partner data API — a context-scoped data token deliberately
 * cannot enumerate its sibling contexts, so it would only ever return the
 * token's own context). Drops the reserved control-plane context + any
 * non-active context.
 */
async function enumerateOwnerTenant(
  tenant: Pick<TenantMembership, 'tenantId' | 'tenantKind'>,
  listAppContexts: AppContextLister,
): Promise<AppContextOption[]> {
  // onlyMine: the data plane shows only the contexts the owner is actually
  // provisioned in (holds an active access profile), not the full tenant set.
  const rows = await listAppContexts(tenant.tenantId, { onlyMine: true });
  return rows
    .filter(
      (c) =>
        c.contextId !== RESERVED_CONTROL_PLANE_CONTEXT_ID &&
        (c.status ?? 'active').toLowerCase() === 'active',
    )
    .map((c) => toOption(c.contextId, tenant, c.name));
}

/**
 * OWNER enumeration across ALL owned tenants (the user's live + test, and any
 * other tenant where they hold the OWNER role). Per-tenant failures are
 * tolerated — a glitch listing one tenant's contexts must not blank out the
 * others; the result is the union of whatever succeeded. Throws only if EVERY
 * owned tenant failed (so the caller surfaces the error state).
 */
async function enumerateForOwner(
  ownerMemberships: ReadonlyArray<TenantMembership>,
  listAppContexts: AppContextLister,
): Promise<AppContextOption[]> {
  const results = await Promise.allSettled(
    ownerMemberships.map((m) => enumerateOwnerTenant(m, listAppContexts)),
  );
  const fulfilled = results.filter(
    (r): r is PromiseFulfilledResult<AppContextOption[]> => r.status === 'fulfilled',
  );
  if (fulfilled.length === 0 && results.length > 0) {
    throw new Error('Context enumeration failed for every owned tenant.');
  }
  return fulfilled.flatMap((r) => r.value);
}

/**
 * SUB_USER enumeration: the distinct contexts where the principal holds an
 * ACTIVE AccessProfile in the ACTIVE tenant (minus reserved). We derive options
 * straight from the profiles (name = contextId) rather than intersecting with
 * listAppContexts — a sub-user may lack the scope to list all contexts, and the
 * mint is the authoritative gate regardless. Context ids are human-meaningful
 * (e.g. 'default'), so the id is an acceptable label until a display-name
 * enrichment lands.
 */
async function enumerateForSubUser(
  tenant: Pick<TenantMembership, 'tenantId' | 'tenantKind'>,
  partnerUserId: string,
): Promise<AppContextOption[]> {
  const principalId = `${PRINCIPAL_PREFIX_USER}${partnerUserId}`;
  const profiles = await drainPages(
    async (startFrom) =>
      (
        await vectrosApiClient(tenant.tenantId).auth.listProfilesForPrincipal(
          startFrom === undefined
            ? { principalId, limit: ENUMERATION_PAGE_SIZE }
            : { principalId, startFrom, limit: ENUMERATION_PAGE_SIZE },
        )
      ).data ?? [], // `{ data, nextCursor }` page envelope → items array
    (p) => p.id,
    ENUMERATION_PAGE_SIZE,
    ENUMERATION_MAX_PAGES,
  );
  const seen = new Set<string>();
  const options: AppContextOption[] = [];
  for (const p of profiles) {
    const id = p.contextId;
    // Default to active when the backend omits status (defensive); skip
    // suspended/reserved/duplicate.
    const active = (p.status ?? 'active').toLowerCase() === 'active';
    if (!id || !active || id === RESERVED_CONTROL_PLANE_CONTEXT_ID || seen.has(id)) continue;
    seen.add(id);
    options.push(toOption(id, tenant));
  }
  return options;
}

/** Pick the initial selection: the active tenant's `default`, else any
 *  `default`, else the first option, else null. */
function pickInitial(
  options: ReadonlyArray<AppContextOption>,
  activeTenant: TenantId | null,
): AppContextOption | null {
  return (
    options.find((o) => o.tenantId === activeTenant && o.contextId === DEFAULT_CONTEXT_ID) ??
    options.find((o) => o.contextId === DEFAULT_CONTEXT_ID) ??
    options[0] ??
    null
  );
}

export interface CurrentContextProviderProps {
  readonly children: ReactNode;
  /** Test/Storybook seed: use these contexts directly + SKIP the async load. */
  readonly initialContexts?: ReadonlyArray<AppContextOption>;
  /** Test/Storybook seed for the active context id. */
  readonly initialContext?: string;
}

export function CurrentContextProvider({
  children,
  initialContexts,
  initialContext,
}: CurrentContextProviderProps): React.JSX.Element {
  const { tenant, activeMembership, memberships, loading: tenantLoading } = useCurrentTenant();
  const { getActivePartnerUserId, listAppContexts } = useAuth();
  const queryClient = useQueryClient();

  const seeded = initialContexts !== undefined;
  // When seeded, resolve the active option (and its tenant) from the seed.
  const seedActive =
    seeded && initialContext != null
      ? (initialContexts.find((o) => o.contextId === initialContext) ?? null)
      : (initialContexts?.[0] ?? null);

  const [contexts, setContexts] = useState<ReadonlyArray<AppContextOption>>(initialContexts ?? []);
  const [context, setContextState] = useState<string | null>(
    initialContext ?? seedActive?.contextId ?? null,
  );
  const [activeTenantId, setActiveTenantIdState] = useState<TenantId | null>(
    seedActive?.tenantId ?? null,
  );
  const [loading, setLoading] = useState<boolean>(!seeded);
  const [error, setError] = useState<boolean>(false);
  const [switching, setSwitching] = useState<boolean>(false);

  // CurrentTenantProvider resolves `tenant` + `activeMembership` (and thus
  // `role`) in the same commit, so the effect never sees an OWNER with a null
  // role. A null role is treated as least-privilege (SUB_USER) defensively.
  const role = activeMembership?.role ?? null;

  // Enumerate the reachable contexts once the tenant layer settles. Skipped when
  // seeded (tests). Re-runs if the membership set, active tenant, or role change.
  // (`memberships` is stable provider state — depending on it doesn't re-run per render.)
  useEffect(() => {
    if (seeded) return;
    if (tenantLoading) {
      setLoading(true);
      return;
    }
    // No active tenant → no contexts to enumerate (user has no membership).
    if (!tenant) {
      setContexts([]);
      setContextState(null);
      setActiveTenantIdState(null);
      setError(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);
    void (async (): Promise<void> => {
      try {
        let options: AppContextOption[];
        if (role === 'OWNER') {
          // Span every tenant the user owns (their live + test).
          options = await enumerateForOwner(
            memberships.filter((m) => m.role === 'OWNER'),
            listAppContexts,
          );
        } else {
          // SUB_USER (or unknown role → least privilege): the active tenant only.
          const partnerUserId = await getActivePartnerUserId();
          options =
            partnerUserId && activeMembership
              ? await enumerateForSubUser(activeMembership, partnerUserId)
              : [];
        }
        if (cancelled) return;
        setContexts(options);
        // Plain setState — no cache clear / invalidate (no data fetched yet).
        const initial = pickInitial(options, tenant);
        setContextState(initial?.contextId ?? null);
        setActiveTenantIdState(initial?.tenantId ?? null);
      } catch {
        // Enumeration failed (e.g. a transient API error). Surface an error
        // state; the mint remains the authoritative access gate regardless.
        if (!cancelled) {
          setContexts([]);
          setContextState(null);
          setActiveTenantIdState(null);
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [seeded, tenantLoading, tenant, role, memberships, activeMembership, getActivePartnerUserId, listAppContexts]);

  const setContext = useCallback(
    async (next: AppContextOption): Promise<void> => {
      // Context (and its tenant) is token-derived, not a stored preference. Drop
      // every (tenant, context) bearer so the next call mints one scoped to the
      // new pair, switch local state, then RESET (not just invalidate) the
      // cached queries so the new selection refetches from empty. The query keys
      // are self-isolating on (tenant, context), so a switch can't render the
      // prior pair's rows under the same key — the reset is to land on a clean,
      // freshly-fetched view (no stale data flashing during the refetch window),
      // not a collision guard. `switching` lets the switcher disable itself so a
      // user can't fire a second swap mid-refetch.
      setSwitching(true);
      try {
        clearVectrosApiTokenCache();
        setContextState(next.contextId);
        setActiveTenantIdState(next.tenantId);
        await queryClient.resetQueries();
      } finally {
        setSwitching(false);
      }
    },
    [queryClient],
  );

  const value = useMemo<CurrentContextValue>(
    () => ({ context, activeTenantId, setContext, contexts, loading, error, switching }),
    [context, activeTenantId, setContext, contexts, loading, error, switching],
  );

  return <CurrentContextContext.Provider value={value}>{children}</CurrentContextContext.Provider>;
}
