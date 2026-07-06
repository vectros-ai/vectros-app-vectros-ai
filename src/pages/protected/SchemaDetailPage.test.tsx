// ---------------------------------------------------------------------------
// SchemaDetailPage tests — metadata + fields + lookups, with the SDK mocked.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { CurrentTenantProvider } from '@vectros-ai/react';
import type { TenantMembership } from '@vectros-ai/react';

import { SchemaDetailPage } from './SchemaDetailPage';
import { CurrentContextProvider } from '../../auth/CurrentContextProvider';
import { TestProviders } from '../../test/TestProviders';

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

function stubGetSchema(getSchema: (req: { id: string }) => Promise<unknown>): void {
  mockedClient.mockReturnValue({ schemas: { getSchema } } as never);
}

function renderDetail(): void {
  render(
    <TestProviders initialEntries={['/schemas/s1']}>
      <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
        <CurrentContextProvider
          initialContexts={[{ contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' }]}
          initialContext="default"
        >
          <Routes>
            <Route path="/schemas/:schemaId" element={<SchemaDetailPage />} />
          </Routes>
        </CurrentContextProvider>
      </CurrentTenantProvider>
    </TestProviders>,
  );
}

describe('SchemaDetailPage', () => {
  beforeEach(() => mockedClient.mockReset());

  it('shows a labeled loading state while the schema is fetching', () => {
    stubGetSchema(vi.fn().mockReturnValue(new Promise(() => {})));
    renderDetail();
    expect(screen.getByRole('progressbar', { name: /loading schema/i })).toBeInTheDocument();
  });

  it('renders schema metadata, fields, lookups, and capabilities', async () => {
    stubGetSchema(
      vi.fn().mockResolvedValue({
        id: 's1',
        typeName: 'intake_form',
        displayName: 'Intake Form',
        description: 'Patient intake',
        storageProfile: 'STANDARD',
        schemaVersion: 3,
        active: true,
        fields: [{ fieldId: 'firstName', fieldType: 'string', required: true, searchable: true }],
        lookupFields: [
          { fieldName: 'email', unique: true },
          { fieldName: 'createdAt', rangeEnabled: true },
        ],
        capabilities: { auditHistory: true, versioning: false },
      }),
    );

    renderDetail();

    expect(await screen.findByRole('heading', { name: 'intake_form' })).toBeInTheDocument();
    expect(screen.getByText('Patient intake')).toBeInTheDocument();
    expect(screen.getByText('STANDARD')).toBeInTheDocument();
    // Field row + lookup rows rendered, incl. the Range column + a range-enabled lookup.
    expect(screen.getByText('firstName')).toBeInTheDocument();
    expect(screen.getByText('email')).toBeInTheDocument();
    expect(screen.getByText('createdAt')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Range' })).toBeInTheDocument();
    // Only the enabled capability surfaces as a chip.
    expect(screen.getByText('auditHistory')).toBeInTheDocument();
    expect(screen.queryByText('versioning')).not.toBeInTheDocument();
  });

  it('shows an error state when the schema fails to load', async () => {
    stubGetSchema(vi.fn().mockRejectedValue(new Error('404')));
    renderDetail();
    expect(await screen.findByText(/couldn.t load this schema/i)).toBeInTheDocument();
  });
});
