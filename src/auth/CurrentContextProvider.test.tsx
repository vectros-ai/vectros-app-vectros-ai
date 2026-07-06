// ---------------------------------------------------------------------------
// CurrentContextProvider tests — the role-branched context enumeration.
//
// The SDK client is mocked (vectrosApiClient) so we control listAppContexts /
// listProfilesForPrincipal. We wrap with TestProviders (AuthProvider mock +
// QueryClient + Intl) and a seeded CurrentTenantProvider so the provider sees a
// resolved tenant + role.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';

import type * as VectrosReact from '@vectros-ai/react';

// Spy the partner-API token-cache clear (the data-plane context-isolation
// mechanism). Partial-mock the package so every other export stays real.
vi.mock('@vectros-ai/react', async (importOriginal) => {
  const actual = await importOriginal<typeof VectrosReact>();
  return { ...actual, clearVectrosApiTokenCache: vi.fn() };
});
import { CurrentTenantProvider, clearVectrosApiTokenCache } from '@vectros-ai/react';
import type { AuthProviderAdapter, TenantMembership } from '@vectros-ai/react';

import { CurrentContextProvider } from './CurrentContextProvider';
import { useCurrentContext } from './useCurrentContext';
import type { AppContextOption } from './useCurrentContext';
import { TestProviders } from '../test/TestProviders';
import { pageOf } from '../test/pageOf';

// Mock the data-plane SDK client — the provider's only outbound dependency.
vi.mock('../api/vectrosApi', () => ({ vectrosApiClient: vi.fn() }));
import { vectrosApiClient } from '../api/vectrosApi';

const mockedClient = vi.mocked(vectrosApiClient);
const mockedClear = vi.mocked(clearVectrosApiTokenCache);

const TENANT = 'tnt_test_0001';

function membership(role: 'OWNER' | 'SUB_USER'): TenantMembership {
  return {
    tenantId: TENANT,
    tenantName: 'Test Org',
    tenantKind: 'test',
    role,
    status: 'ACTIVE',
    partnerId: 'ptr_0001',
  };
}

/** Stub a VectrosClient whose `.auth` exposes the two enumeration methods. */
function stubClient(auth: {
  listAppContexts?: () => Promise<unknown>;
  listProfilesForPrincipal?: (args: { principalId: string }) => Promise<unknown>;
}): void {
  mockedClient.mockReturnValue({ auth } as never);
}

/** Renders the provider state for assertions. */
function Probe(): React.JSX.Element {
  const { context, contexts, loading, error } = useCurrentContext();
  return (
    <div>
      <span data-testid="ctx">{context ?? 'none'}</span>
      <span data-testid="list">{contexts.map((c) => c.contextId).join(',')}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{String(error)}</span>
    </div>
  );
}

/** Probe that surfaces each option's `contextId:tenantKind` to prove cross-tenant enumeration. */
function KindProbe(): React.JSX.Element {
  const { contexts } = useCurrentContext();
  return (
    <span data-testid="list">{contexts.map((c) => `${c.contextId}:${c.tenantKind}`).join(',')}</span>
  );
}

function renderWithRole(
  role: 'OWNER' | 'SUB_USER',
  partnerUserId: string | null = null,
  authOverrides: Partial<AuthProviderAdapter> = {},
): void {
  render(
    <TestProviders
      authOverrides={{
        getActivePartnerUserId: vi.fn().mockResolvedValue(partnerUserId),
        ...authOverrides,
      }}
    >
      <CurrentTenantProvider initialMemberships={[membership(role)]} initialTenant={TENANT}>
        <CurrentContextProvider>
          <Probe />
        </CurrentContextProvider>
      </CurrentTenantProvider>
    </TestProviders>,
  );
}

describe('CurrentContextProvider enumeration', () => {
  beforeEach(() => {
    mockedClient.mockReset();
  });

  it('OWNER: lists all contexts except the reserved (and non-active) ones', async () => {
    // OWNER enumeration reads the adapter's developer-API lister (NOT the
    // partner client) — returns AppContextSummary rows, not a page envelope.
    const listAppContexts = vi.fn().mockResolvedValue([
      { contextId: 'default', name: 'Default', status: 'active' },
      { contextId: 'vectros-admin', name: 'Admin', status: 'active' }, // reserved → excluded
      { contextId: 'project-x', name: 'Project X', status: 'active' },
      { contextId: 'old', name: 'Old', status: 'purging' }, // non-active → excluded
    ]);

    renderWithRole('OWNER', null, { listAppContexts });

    expect(await screen.findByText('default,project-x')).toBeInTheDocument();
    // Initial selection prefers 'default'.
    expect(screen.getByTestId('ctx')).toHaveTextContent('default');
    expect(screen.getByTestId('error')).toHaveTextContent('false');
    // The data plane requests only the contexts the owner is provisioned in.
    expect(listAppContexts).toHaveBeenCalledWith(TENANT, { onlyMine: true });
  });

  it('OWNER: enumerates contexts across ALL owned tenants (live + test)', async () => {
    const LIVE = 'tnt_live_0001';
    const TEST = 'tnt_test_0001';
    // The adapter's lister is called once per owned tenant; distinct per-tenant
    // results: live has only `default`; test adds a project.
    const listAppContexts = vi.fn().mockImplementation((tenantId: string) =>
      Promise.resolve(
        tenantId === LIVE
          ? [{ contextId: 'default', name: 'Default' }]
          : [
              { contextId: 'default', name: 'Default' },
              { contextId: 'project-x', name: 'Project X' },
            ],
      ),
    );

    render(
      <TestProviders authOverrides={{ listAppContexts }}>
        <CurrentTenantProvider
          initialMemberships={[
            { tenantId: LIVE, tenantName: 'Live', tenantKind: 'live', role: 'OWNER', status: 'ACTIVE', partnerId: 'ptr_0001' },
            { tenantId: TEST, tenantName: 'Test', tenantKind: 'test', role: 'OWNER', status: 'ACTIVE', partnerId: 'ptr_0001' },
          ]}
          initialTenant={LIVE}
        >
          <CurrentContextProvider>
            <KindProbe />
          </CurrentContextProvider>
        </CurrentTenantProvider>
      </TestProviders>,
    );

    // Contexts from BOTH tenants appear, each tagged with its tenant kind.
    expect(
      await screen.findByText('default:live,default:test,project-x:test'),
    ).toBeInTheDocument();
    expect(listAppContexts).toHaveBeenCalledWith(LIVE, { onlyMine: true });
    expect(listAppContexts).toHaveBeenCalledWith(TEST, { onlyMine: true });
  });

  it('OWNER: tolerates a per-tenant enumeration failure (union of survivors, no error)', async () => {
    const LIVE = 'tnt_live_0001';
    const TEST = 'tnt_test_0001';
    // Live fails, test succeeds → the surviving tenant's contexts still show and
    // the provider does NOT flip to the error state (allSettled, not all).
    const listAppContexts = vi.fn().mockImplementation((tenantId: string) =>
      tenantId === LIVE
        ? Promise.reject(new Error('live glitch'))
        : Promise.resolve([
            { contextId: 'default', name: 'Default' },
            { contextId: 'project-x', name: 'Project X' },
          ]),
    );

    render(
      <TestProviders authOverrides={{ listAppContexts }}>
        <CurrentTenantProvider
          initialMemberships={[
            { tenantId: LIVE, tenantName: 'Live', tenantKind: 'live', role: 'OWNER', status: 'ACTIVE', partnerId: 'ptr_0001' },
            { tenantId: TEST, tenantName: 'Test', tenantKind: 'test', role: 'OWNER', status: 'ACTIVE', partnerId: 'ptr_0001' },
          ]}
          initialTenant={LIVE}
        >
          <CurrentContextProvider>
            <Probe />
          </CurrentContextProvider>
        </CurrentTenantProvider>
      </TestProviders>,
    );

    expect(await screen.findByText('default,project-x')).toBeInTheDocument();
    expect(screen.getByTestId('error')).toHaveTextContent('false');
  });

  it('SUB_USER: lists only contexts with an active profile, by principal', async () => {
    const listProfilesForPrincipal = vi.fn().mockResolvedValue(
      pageOf([
        { contextId: 'project-x', status: 'active' },
        { contextId: 'vectros-admin', status: 'active' }, // reserved → excluded
        { contextId: 'archived', status: 'suspended' }, // inactive → excluded
      ]),
    );
    stubClient({ listProfilesForPrincipal });

    renderWithRole('SUB_USER', 'pu_42');

    // Selector disambiguates: 'project-x' is both the only list entry and the
    // active context, so it appears in two spans.
    expect(
      await screen.findByText('project-x', { selector: '[data-testid="list"]' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('ctx')).toHaveTextContent('project-x');
    // Principal is usr_<partnerUserId> (NOT the Cognito sub); pagination adds a limit.
    expect(listProfilesForPrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'usr_pu_42' }),
    );
  });

  it('surfaces an error state when enumeration fails', async () => {
    renderWithRole('OWNER', null, {
      listAppContexts: vi.fn().mockRejectedValue(new Error('boom')),
    });

    expect(await screen.findByText('true', { selector: '[data-testid="error"]' })).toBeInTheDocument();
    expect(screen.getByTestId('ctx')).toHaveTextContent('none');
  });

  it('SUB_USER with no resolvable partnerUserId fails closed to an empty context list', async () => {
    // Fail-closed: a sub-user whose active_partner_user_id can't be resolved
    // must reach ZERO contexts (not fall through to an owner-style listing).
    // The mint stays the authoritative gate, but the UI must not over-enumerate.
    const listProfilesForPrincipal = vi.fn();
    const listAppContexts = vi.fn();
    stubClient({ listProfilesForPrincipal, listAppContexts });

    renderWithRole('SUB_USER', null);

    expect(await screen.findByText('false', { selector: '[data-testid="loading"]' })).toBeInTheDocument();
    expect(screen.getByTestId('list')).toHaveTextContent('');
    expect(screen.getByTestId('ctx')).toHaveTextContent('none');
    // Neither enumeration path ran — no owner-style fallthrough.
    expect(listProfilesForPrincipal).not.toHaveBeenCalled();
    expect(listAppContexts).not.toHaveBeenCalled();
  });

  it('treats an unknown (non-OWNER) role as least-privilege — the SUB_USER path, not OWNER', async () => {
    const listProfilesForPrincipal = vi.fn().mockResolvedValue(pageOf([]));
    const listAppContexts = vi.fn();
    stubClient({ listProfilesForPrincipal, listAppContexts });

    // Cast an unexpected role string to prove the default branch is sub-user.
    renderWithRole('VIEWER' as never, 'pu_77');

    expect(await screen.findByText('false', { selector: '[data-testid="loading"]' })).toBeInTheDocument();
    // Took the principal-scoped (SUB_USER) path — NOT the owner listing.
    expect(listProfilesForPrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'usr_pu_77' }),
    );
    expect(listAppContexts).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setContext — the data-plane context-switch isolation mechanism.
//
// Switching the active context MUST drop the partner-API token cache so the
// next call re-mints an st_* bearer scoped to the NEW context, then invalidate
// all context-scoped queries so cached PHI from the prior context can't be
// served under the new one. The ContextSwitcher 'switches on selection' test
// only asserts the visible label changes (driven by setContextState) — it
// would stay green even if clearVectrosApiTokenCache / invalidateQueries were
// dropped. These assert the security-critical side-effects directly.
// ---------------------------------------------------------------------------

const PROJECT_X: AppContextOption = {
  contextId: 'project-x',
  name: 'Project X',
  tenantId: TENANT,
  tenantKind: 'test',
};
const TWO_CONTEXTS: ReadonlyArray<AppContextOption> = [
  { contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' },
  PROJECT_X,
];

/** Probe exposing setContext via a button so a test can drive a real switch. */
function SwitchProbe(): React.JSX.Element {
  const { context, setContext } = useCurrentContext();
  return (
    <div>
      <span data-testid="ctx">{context ?? 'none'}</span>
      <button type="button" onClick={() => void setContext(PROJECT_X)}>
        switch
      </button>
    </div>
  );
}

describe('CurrentContextProvider.setContext (context-switch isolation)', () => {
  beforeEach(() => {
    mockedClient.mockReset();
    mockedClear.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears the partner-API token cache AND resets queries (clear BEFORE reset), then updates context', async () => {
    const user = userEvent.setup();
    const resetSpy = vi.spyOn(QueryClient.prototype, 'resetQueries');

    render(
      <TestProviders>
        <CurrentTenantProvider
          initialMemberships={[membership('OWNER')]}
          initialTenant={TENANT}
        >
          <CurrentContextProvider initialContexts={TWO_CONTEXTS} initialContext="default">
            <SwitchProbe />
          </CurrentContextProvider>
        </CurrentTenantProvider>
      </TestProviders>,
    );

    expect(screen.getByTestId('ctx')).toHaveTextContent('default');

    await user.click(screen.getByRole('button', { name: 'switch' }));

    // Both isolation side-effects fired.
    expect(mockedClear).toHaveBeenCalledTimes(1);
    expect(resetSpy).toHaveBeenCalled();
    // Ordering: the cache must be dropped BEFORE the reset/refetch, else the
    // reset queries could re-mint/reuse the prior context's bearer.
    expect(mockedClear.mock.invocationCallOrder[0]).toBeLessThan(
      resetSpy.mock.invocationCallOrder[0]!,
    );
    // Local state advanced to the new context.
    expect(screen.getByTestId('ctx')).toHaveTextContent('project-x');
  });
});
