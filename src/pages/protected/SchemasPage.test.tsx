// ---------------------------------------------------------------------------
// SchemasPage tests — schema list table, with the SDK mocked.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CurrentTenantProvider } from '@vectros-ai/react';
import type { TenantMembership } from '@vectros-ai/react';

import { SchemasPage } from './SchemasPage';
import { CurrentContextProvider } from '../../auth/CurrentContextProvider';
import { TestProviders } from '../../test/TestProviders';
import { pageOf } from '../../test/pageOf';

vi.mock('../../api/vectrosApi', () => ({ vectrosApiClient: vi.fn() }));
import { vectrosApiClient } from '../../api/vectrosApi';

const mockedClient = vi.mocked(vectrosApiClient);
const TENANT = 'tnt_0001';

const OWNER: TenantMembership = {
  tenantId: TENANT,
  tenantName: 'Test Org',
  tenantKind: 'test',
  role: 'OWNER',
  status: 'ACTIVE',
  partnerId: 'ptr_0001',
};

function stub(listSchemas: () => Promise<unknown>): void {
  mockedClient.mockReturnValue({ schemas: { listSchemas } } as never);
}

function renderPage(): void {
  render(
    <TestProviders>
      <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
        <CurrentContextProvider
          initialContexts={[{ contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' }]}
          initialContext="default"
        >
          <SchemasPage />
        </CurrentContextProvider>
      </CurrentTenantProvider>
    </TestProviders>,
  );
}

describe('SchemasPage', () => {
  beforeEach(() => mockedClient.mockReset());

  it('lists schemas with a link to each schema detail', async () => {
    stub(
      vi.fn().mockResolvedValue(pageOf([
        {
          id: 's1',
          typeName: 'intake_form',
          displayName: 'Intake Form',
          schemaVersion: 2,
          active: true,
          fields: [{ fieldId: 'firstName', fieldType: 'string' }],
        },
      ])),
    );

    renderPage();

    const link = await screen.findByRole('link', { name: 'intake_form' });
    expect(link).toHaveAttribute('href', '/schemas/s1');
    expect(screen.getByText('Intake Form')).toBeInTheDocument();
  });

  it('shows a labeled loading state while schemas are fetching', () => {
    stub(vi.fn().mockReturnValue(new Promise(() => {}))); // never resolves
    renderPage();
    expect(screen.getByRole('progressbar', { name: /loading schemas/i })).toBeInTheDocument();
  });

  it('shows an empty state when the context has no schemas', async () => {
    stub(vi.fn().mockResolvedValue(pageOf([])));
    renderPage();
    expect(await screen.findByText(/no schemas defined/i)).toBeInTheDocument();
  });

  it('shows an error state when schemas fail to load', async () => {
    stub(vi.fn().mockRejectedValue(new Error('boom')));
    renderPage();
    expect(await screen.findByText(/couldn.t load this context.s schemas/i)).toBeInTheDocument();
  });
});
