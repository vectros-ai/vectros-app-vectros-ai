// ---------------------------------------------------------------------------
// TestProviders — the full provider stack for page/route tests.
//
// Composes (outer → inner): MemoryRouter → QueryClient → IntlProvider →
// AuthProvider(mock). This mirrors the runtime nesting in main.tsx closely
// enough that a routed page renders exactly as it would in the app, while
// every external dependency (auth adapter, router history) is controllable
// from the test.
//
//   - `initialEntries` seeds the MemoryRouter history (default `['/']`).
//   - `authOverrides` pins specific adapter methods (e.g. a signed-in user,
//     a signIn that resolves MFA_REQUIRED). Defaults come from
//     makeMockAuthProvider. Ignored when `adapter` is supplied.
//   - `adapter` supplies an already-built mock adapter instead of one built
//     from `authOverrides` — needed when a test ALSO wraps children in its
//     own `<CurrentTenantProvider tenancyProvider={...}>` (getActivePartnerUserId/
//     listAppContexts are VectrosTenancyProvider methods surfaced through
//     CurrentTenantProvider's pass-through now, not through useAuth() — see
//     CurrentContextProvider.test.tsx) and needs the SAME adapter instance in
//     both places so overrides on tenancy methods actually take effect.
//
// Tests that need the active-tenant context (CurrentTenantProvider) wrap their
// subject in it explicitly — most shell tests don't, because useCurrentTenant
// has an inert no-provider fallback.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import type { Location } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@vectros-ai/react';

import { I18N_DEFAULT_LOCALE, IntlProvider } from '../i18n/IntlProvider';
import { makeMockAuthProvider } from './mockAuthProvider';
import type { FullMockProvider } from './mockAuthProvider';

interface TestProvidersProps {
  readonly children: ReactNode;
  /**
   * MemoryRouter seed history. Defaults to `['/']`. Entries may be a bare path
   * string or a partial `Location` (e.g. `{ pathname, state }`) to seed router
   * state such as a deep-link `from` redirect target.
   */
  readonly initialEntries?: ReadonlyArray<string | Partial<Location>>;
  /** Auth-adapter method overrides merged over makeMockAuthProvider defaults. Ignored when `adapter` is supplied. */
  readonly authOverrides?: Partial<FullMockProvider>;
  /** Pre-built mock adapter, used as-is instead of building one from `authOverrides`. See module header. */
  readonly adapter?: FullMockProvider;
  /**
   * Query stale time. Defaults to `Infinity` so assertion timing is
   * deterministic; pass `0` to exercise the automatic refetches production's
   * finite stale time allows (returning to a cached key, a reconnect).
   */
  readonly staleTime?: number | undefined;
}

export function TestProviders({
  children,
  initialEntries = ['/'],
  authOverrides,
  adapter,
  staleTime = Infinity,
}: TestProvidersProps): React.JSX.Element {
  // A test-strict client: no retries, no background refetch, infinite gc so
  // assertion timing is deterministic. Constructed per render (each test's
  // render mounts a fresh TestProviders).
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime },
      mutations: { retry: false },
    },
  });
  return (
    <MemoryRouter initialEntries={[...initialEntries]}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider locale={I18N_DEFAULT_LOCALE}>
          <AuthProvider provider={adapter ?? makeMockAuthProvider(authOverrides)}>
            {children}
          </AuthProvider>
        </IntlProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}
