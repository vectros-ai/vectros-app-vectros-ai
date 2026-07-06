// ---------------------------------------------------------------------------
// listAllSchemas — drain every schema in a (tenant, context) into one array.
//
// As of SDK 0.23 `schemas.listSchemas` is cursor-paginated (the
// `{ data, nextCursor }` page envelope, default 20/page) where it previously returned
// the full set as a bare array. Every schema consumer — the record type pickers,
// the schema-driven form, the table column derivations, the schema list — needs
// the COMPLETE set; a partial first page would silently drop record types. So we
// drain to exhaustion here, in one shared place.
//
// Lives in lib/ (not api/vectrosApi) on purpose: the page tests mock the
// `vectrosApiClient` boundary, and keeping this helper outside that mocked module
// lets the real drain run against the mocked client. Every consumer keys its
// query on `dataQueryKeys.schemas`, so react-query caches a single result.
// ---------------------------------------------------------------------------

import { vectrosApiClient } from '../api/vectrosApi';
import type { SchemaResponse } from '../api/vectrosApi';
import type { TenantId } from '../auth';
import { drainPages } from './drainPages';

/** Page size for schema enumeration — the SDK ceiling (its default is only 20). */
const SCHEMA_PAGE_SIZE = 100;

/**
 * List every schema reachable in `(tenantId, contextId)`, draining all pages.
 * Omit `contextId` for the tenant-default context.
 */
export function listAllSchemas(tenantId: TenantId, contextId?: string): Promise<SchemaResponse[]> {
  return drainPages<SchemaResponse>(
    async (startFrom) =>
      (
        await vectrosApiClient(tenantId, contextId).schemas.listSchemas(
          startFrom === undefined
            ? { limit: SCHEMA_PAGE_SIZE }
            : { startFrom, limit: SCHEMA_PAGE_SIZE },
        )
      ).data ?? [],
    (s) => s.id,
    SCHEMA_PAGE_SIZE,
  );
}
