// ---------------------------------------------------------------------------
// TanStack Query keys for the data-plane reads.
//
// Every key is prefixed with the active `(tenant, context)` pair. The data plane
// spans a user's live + test tenants, and the same context name (e.g. `default`)
// exists in BOTH — so the contextId alone is NOT unique. Keying on the tenant as
// well makes the cache self-isolating: a prior tenant's rows can never be served
// under a same-named context in another tenant, because their keys differ.
//
// CurrentContextProvider.setContext still RESETS queries on a switch — not as a
// collision guard (the keys handle that now) but to drop the old context's cached
// data so a switch always lands on a clean, freshly-fetched view. See
// src/lib/queryClient.ts + CurrentContextProvider.setContext.
// ---------------------------------------------------------------------------

export const dataQueryKeys = {
  /** All schemas in the active context. */
  schemas: (tenant: string, context: string): readonly ['data', string, string, 'schemas'] =>
    ['data', tenant, context, 'schemas'] as const,
  /** A single schema by id in the active context. */
  schema: (
    tenant: string,
    context: string,
    schemaId: string,
  ): readonly ['data', string, string, 'schema', string] =>
    ['data', tenant, context, 'schema', schemaId] as const,
  /** Records of a given type in the active context. */
  records: (
    tenant: string,
    context: string,
    typeName: string,
  ): readonly ['data', string, string, 'records', string] =>
    ['data', tenant, context, 'records', typeName] as const,
  /**
   * A server-side records lookup on a schema lookup field — exact / range /
   * prefix, with a sort direction. `descriptor` is a stable serialization of the
   * lookup (field + mode + bounds + order) so a changed query refetches cleanly.
   */
  recordsLookup: (
    tenant: string,
    context: string,
    typeName: string,
    descriptor: string,
  ): readonly ['data', string, string, 'recordsLookup', string, string] =>
    ['data', tenant, context, 'recordsLookup', typeName, descriptor] as const,
  /** A single record by id in the active context. */
  record: (
    tenant: string,
    context: string,
    recordId: string,
  ): readonly ['data', string, string, 'record', string] =>
    ['data', tenant, context, 'record', recordId] as const,
  /** A record's audit-trail version history (GET /v1/records/{id}/versions). */
  recordVersions: (
    tenant: string,
    context: string,
    recordId: string,
  ): readonly ['data', string, string, 'recordVersions', string] =>
    ['data', tenant, context, 'recordVersions', recordId] as const,
  /**
   * A reference-field lookup: resolve a target record by (type, lookup field,
   * value) — powers the reference cross-links on the record detail view.
   */
  recordLookup: (
    tenant: string,
    context: string,
    type: string,
    field: string,
    value: string,
  ): readonly ['data', string, string, 'recordLookup', string, string, string] =>
    ['data', tenant, context, 'recordLookup', type, field, value] as const,
  /** All folders in the active context. */
  folders: (tenant: string, context: string): readonly ['data', string, string, 'folders'] =>
    ['data', tenant, context, 'folders'] as const,
  /**
   * Documents in the active context, optionally scoped to one folder
   * (server-side `listDocuments({folderId})`). The base key (no folderId)
   * is a PREFIX of every folder-scoped key, so `invalidateQueries({queryKey:
   * documents(tenant, context)})` refreshes all folder views in one call.
   */
  documents: (
    tenant: string,
    context: string,
    folderId?: string,
  ):
    | readonly ['data', string, string, 'documents']
    | readonly ['data', string, string, 'documents', string] =>
    folderId === undefined
      ? (['data', tenant, context, 'documents'] as const)
      : (['data', tenant, context, 'documents', folderId] as const),
  /**
   * A server-side documents lookup on a lookup field (or `externalId`) — exact /
   * range / prefix, with a sort direction. `descriptor` is a stable
   * serialization of the lookup (field + mode + bounds + order) so a changed
   * query refetches cleanly. Mirrors `recordsLookup`.
   */
  documentsLookup: (
    tenant: string,
    context: string,
    typeName: string,
    descriptor: string,
  ): readonly ['data', string, string, 'documentsLookup', string, string] =>
    ['data', tenant, context, 'documentsLookup', typeName, descriptor] as const,
  /** A single document's metadata by id in the active context. */
  document: (
    tenant: string,
    context: string,
    documentId: string,
  ): readonly ['data', string, string, 'document', string] =>
    ['data', tenant, context, 'document', documentId] as const,
  /** A single document's extracted text by id in the active context. */
  documentText: (
    tenant: string,
    context: string,
    documentId: string,
  ): readonly ['data', string, string, 'documentText', string] =>
    ['data', tenant, context, 'documentText', documentId] as const,
  /**
   * The FETCHED body of a file-backed document (presigned download URL →
   * client-side GET) — the click-to-view-inline path for file-mode Markdown
   * docs, distinct from `documentText` (the stored extracted text endpoint).
   */
  documentFileText: (
    tenant: string,
    context: string,
    documentId: string,
  ): readonly ['data', string, string, 'documentFileText', string] =>
    ['data', tenant, context, 'documentFileText', documentId] as const,
  /** A document's audit-trail version history (GET /v1/documents/{id}/versions). */
  documentVersions: (
    tenant: string,
    context: string,
    documentId: string,
  ): readonly ['data', string, string, 'documentVersions', string] =>
    ['data', tenant, context, 'documentVersions', documentId] as const,
  /**
   * A search over the active context. `descriptor` is a stable serialization of
   * every filter that affects the result set (mode, content scope, folder, type)
   * so a changed filter refetches cleanly.
   */
  search: (
    tenant: string,
    context: string,
    query: string,
    descriptor: string,
  ): readonly ['data', string, string, 'search', string, string] =>
    ['data', tenant, context, 'search', query, descriptor] as const,
  /**
   * The inference model registry. Plan-gated (per tenant), not context-gated —
   * the catalogue is identical across a tenant's contexts — but we still key on
   * `(tenant, context)` for uniformity with the reset-on-context-switch contract.
   */
  inferenceModels: (
    tenant: string,
    context: string,
  ): readonly ['data', string, string, 'inferenceModels'] =>
    ['data', tenant, context, 'inferenceModels'] as const,
};
