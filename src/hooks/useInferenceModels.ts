// ---------------------------------------------------------------------------
// useInferenceModels — the inference model registry for the AI workspace's model
// picker. `listInferenceModels` returns the full catalogue
// annotated with plan tiers (`availableOn`) + per-1k-token credit rates; models
// are plan-gated, not context-gated, so the list is identical across a tenant's
// contexts. We soft-annotate (show all, label tiers/rates) rather than hard-gate
// — there's no clean client-side source for the tenant's plan tier.
// Scoped to the active (tenant, context) by the bearer token.
// ---------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

import { useActiveContextId, useActiveTenantId } from '../auth';
import { vectrosApiClient } from '../api/vectrosApi';
import type { Vectros } from '../api/vectrosApi';
import { dataQueryKeys } from '../lib/dataQueryKeys';

export function useInferenceModels(): UseQueryResult<Vectros.ModelsResponse> {
  const tenant = useActiveTenantId();
  const context = useActiveContextId();
  return useQuery({
    queryKey: dataQueryKeys.inferenceModels(tenant, context),
    queryFn: () => vectrosApiClient(tenant, context).inference.listInferenceModels(),
    // The catalogue rarely changes within a session — cache generously.
    staleTime: 5 * 60 * 1000,
  });
}
