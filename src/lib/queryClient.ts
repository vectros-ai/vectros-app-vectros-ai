// ---------------------------------------------------------------------------
// TanStack Query (`@tanstack/react-query`) default configuration.
//
// One singleton lives at the app root (instantiated in `main.tsx`); tests
// instantiate fresh per-test clients via `createQueryClient()` to keep the
// cache from leaking across `it()` blocks.
//
// The defaults below are the OPINIONATED reference-app baseline (shared with
// ui/admin-app). Partner forks can override per-query via the second argument
// to `useQuery` / `useMutation`, or replace the client entirely.
//
//   - `retry: 1` — single transparent retry then bubble. Data surfaces
//     shouldn't auto-retry forever; a single retry papers over the typical
//     transient network blip without masking real outages.
//
//   - `staleTime: 30_000` — 30s. Data list reads tolerate up to 30s of
//     staleness; this kills the cross-component duplicate-fetch pattern.
//
//   - `gcTime: 5 * 60_000` — 5min. Matches the Rust authorizer's policy-cache
//     window so reads of authorizer-bound data have predictable freshness.
//
//   - `refetchOnWindowFocus: false` — OFF. Default TanStack Query behavior
//     refetches on tab focus, which surprises partners migrating from
//     `useEffect` patterns (sudden network activity, jumping spinners).
//
//   - `mutations.retry: 0` — mutations NEVER auto-retry. Callers must decide
//     whether a given mutation should retry (idempotency, side effects, etc.).
//
// IMPORTANT (context-scoping): a context switch calls
// `queryClient.invalidateQueries()`, so every data query MUST be keyed by the
// active context (e.g. `[context, 'records', …]`). That makes the post-switch
// refetch land under the new (tenant, context) token cleanly.
// ---------------------------------------------------------------------------

import { QueryClient } from '@tanstack/react-query';

export const QUERY_CLIENT_DEFAULTS = {
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
} as const;

export function createQueryClient(): QueryClient {
  return new QueryClient(QUERY_CLIENT_DEFAULTS);
}
