// ---------------------------------------------------------------------------
// Vectros API client — app.vectros.ai's @vectros-ai/sdk wiring.
//
// **Why the SDK (not hand-rolled axios):** app.vectros.ai is a public-reference
// app for developers building a data app on the Vectros API. "Use our SDK" is the
// developer story; the SDK is type-safe (regenerated from the backend's OpenAPI
// spec), so call sites stay in sync with backend changes by construction.
//
// **Auth bridge:** the SDK accepts a `token: () => Promise<string>` supplier, so
// we delegate token resolution to `getVectrosApiToken(tenantId, contextId)` from
// @vectros-ai/react. Its race-condition defenses (in-flight coalescing +
// cacheGeneration) carry over unchanged.
//
// **Per-(tenant, context) client instances — the load-bearing detail.** Unlike
// admin-app (control-plane, one client per tenant), app.vectros.ai is the DATA
// plane: single-tenant-at-a-time but MULTI-CONTEXT. Every data call is scoped to
// (tenant, context) by the `st_*` token's claims, unspoofably. So the
// token supplier must be closed over BOTH tenantId AND contextId, and we cache
// one client per (tenant, context) pair. A context switch routes subsequent
// calls to the client for the new context (a fresh slot, minting a fresh bearer).
//
// **The bootstrap (no-context) client.** Calling `vectrosApiClient(tenantId)`
// with no contextId mints in the caller's default/derived context — used to
// ENUMERATE the contexts a user can reach (the context switcher's listAppContexts
// / listProfilesForPrincipal) BEFORE a context is selected. Post-selection, data
// pages call `vectrosApiClient(tenant, activeContext)`.
//
// See also: @vectros-ai/react's vectrosApiTokenCache (the (tenant, context)
// bearer cache this client's token supplier reads from).
// ---------------------------------------------------------------------------

import { VectrosClient } from '@vectros-ai/sdk';

import { getVectrosApiToken } from '../auth';
import type { TenantId } from '../auth';
import { API_CONFIG } from '../config';

/**
 * Composite cache key for a (tenant, context) client slot. The `|` separator
 * can't appear in a tenantId or a validated contextId, so the join is
 * unambiguous; a missing contextId collapses to `<tenantId>|` (the bootstrap /
 * default-context client). Mirrors the token cache's slotKey so a client and
 * its bearer share the same partition.
 */
function slotKey(tenantId: TenantId, contextId?: string): string {
  return `${tenantId}|${contextId ?? ''}`;
}

/** Lazy-init cache. One VectrosClient per (tenant, context) — the token supplier
 *  is closed over both, so slots must not be shared across contexts. */
const clientsBySlot = new Map<string, VectrosClient>();

/**
 * Get the configured `VectrosClient` for `(tenantId, contextId)`. Lazily
 * instantiates + caches; subsequent calls for the same slot return the same
 * instance so consumers don't spawn extra clients per render.
 *
 * Omit `contextId` for the bootstrap/default-context client (context
 * enumeration). Supply it for data-plane reads/writes scoped to a chosen
 * context.
 *
 * Usage from pages:
 *
 *     const tenant = useActiveTenantId();
 *     const context = useActiveContextId();
 *     const records = await vectrosApiClient(tenant, context).records.list();
 */
export function vectrosApiClient(tenantId: TenantId, contextId?: string): VectrosClient {
  const key = slotKey(tenantId, contextId);
  let client = clientsBySlot.get(key);
  if (!client) {
    client = new VectrosClient({
      // Same base URL for every (tenant, context); the (tenant, context)
      // discrimination happens server-side via the bearer token's claims, not
      // the URL.
      environment: API_CONFIG.vectrosApiBase,
      token: (): Promise<string> => getVectrosApiToken(tenantId, contextId),
    });
    clientsBySlot.set(key, client);
  }
  return client;
}

/**
 * Test-only helper. Clears the per-slot client cache so each test starts with
 * fresh instances. NOT exported from the auth barrel; only test files import it.
 */
export function __resetVectrosApiClientCacheForTest(): void {
  clientsBySlot.clear();
}

// ---------------------------------------------------------------------------
// Re-exports for consumer convenience (the SDK's request/response types live
// under the `Vectros` namespace — Fern's convention).
// ---------------------------------------------------------------------------

export { Vectros } from '@vectros-ai/sdk';
export type { VectrosClient } from '@vectros-ai/sdk';
export { VectrosError, VectrosTimeoutError } from '@vectros-ai/sdk';

// Type re-exports for the data-plane shapes the pages consume. Derived from the
// method return signatures (rather than `Vectros.RecordResponse` directly) so
// the interface type survives the SDK's namespace re-export indirection — the
// same pattern admin-app uses for its control-plane types.
import type { VectrosClient as _VectrosClient } from '@vectros-ai/sdk';

type _Records = _VectrosClient['records'];
type _Schemas = _VectrosClient['schemas'];
type _Folders = _VectrosClient['folders'];
type _Documents = _VectrosClient['documents'];
type _Search = _VectrosClient['search'];

/** A single record (id, typeName, payload, status, ownership, version, …). */
export type RecordResponse = Awaited<ReturnType<_Records['getRecord']>>;
/** A schema describing a record type (typeName, displayName, fields, …). */
export type SchemaResponse = NonNullable<
  Awaited<ReturnType<_Schemas['listSchemas']>>['data']
>[number];
/** A folder (id, name, parentFolderId, depth, ownership, timestamps, …). */
export type FolderResponse = Awaited<ReturnType<_Folders['getFolder']>>;
/** A document's metadata (id, title, status, folderId, fileType, version, …). */
export type DocumentResponse = Awaited<ReturnType<_Documents['getDocument']>>;
/** A document's full extracted/ingested text. */
export type DocumentTextResponse = Awaited<ReturnType<_Documents['getDocumentText']>>;
/** A single audit-trail version row (changeType, changedBy, createdAt, changedFields, …).
 *  Shared by records + documents — both `getXVersions` return the same page. */
export type VersionEntry = NonNullable<
  Awaited<ReturnType<_Records['getRecordVersions']>>['data']
>[number];
/** A unified search response (results + totals + timing). */
export type SearchResponse = Awaited<ReturnType<_Search['content']>>;
/** A single search hit (sourceType-discriminated document/record chunk). */
export type SearchResultItem = NonNullable<SearchResponse['results']>[number];
