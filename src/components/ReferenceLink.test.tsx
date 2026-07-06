// ---------------------------------------------------------------------------
// ReferenceLink — the reference cross-link resolution UX. Resolves a
// reference value to its target record via lookupRecords and renders a link;
// degrades to plain text (never a dead link) while pending or when unresolved.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CurrentTenantProvider } from '@vectros-ai/react';
import type { TenantMembership } from '@vectros-ai/react';

import { ReferenceLink } from './ReferenceLink';
import { CurrentContextProvider } from '../auth/CurrentContextProvider';
import { TestProviders } from '../test/TestProviders';
import { pageOf } from '../test/pageOf';

vi.mock('../api/vectrosApi', () => ({ vectrosApiClient: vi.fn() }));
import { vectrosApiClient } from '../api/vectrosApi';

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

function stubLookup(
  lookupRecords: (req: { type: string; field: string; value: string }) => Promise<unknown>,
): void {
  mockedClient.mockReturnValue({ records: { lookupRecords } } as never);
}

function renderLink(
  props: { targetTypeName: string; targetField: string; value: string } = {
    targetTypeName: 'employee',
    targetField: 'externalId',
    value: 'mgr-ext-1',
  },
): void {
  render(
    <TestProviders>
      <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
        <CurrentContextProvider
          initialContexts={[{ contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' }]}
          initialContext="default"
        >
          <ReferenceLink {...props} />
        </CurrentContextProvider>
      </CurrentTenantProvider>
    </TestProviders>,
  );
}

describe('ReferenceLink', () => {
  beforeEach(() => mockedClient.mockReset());

  it('resolves the value to a link to the target record detail', async () => {
    const lookupRecords = vi
      .fn()
      .mockResolvedValue(pageOf([{ id: 'emp_99', typeName: 'employee' }]));
    stubLookup(lookupRecords);

    renderLink();

    const link = await screen.findByRole('link', { name: 'mgr-ext-1' });
    expect(link).toHaveAttribute('href', '/records/emp_99');
    expect(lookupRecords).toHaveBeenCalledWith({
      type: 'employee',
      field: 'externalId',
      value: 'mgr-ext-1',
    });
  });

  it('shows the raw value as plain text (never a dead link) when unresolved', async () => {
    stubLookup(vi.fn().mockResolvedValue([])); // no match

    renderLink();

    // The value is shown so the data isn't lost...
    expect(await screen.findByText('mgr-ext-1')).toBeInTheDocument();
    // ...but it is not a link.
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'mgr-ext-1' })).not.toBeInTheDocument(),
    );
  });

  it('shows the raw value (no link) while the lookup is pending', () => {
    // A never-resolving lookup keeps the query in flight.
    stubLookup(vi.fn().mockReturnValue(new Promise(() => {})));

    renderLink();

    expect(screen.getByText('mgr-ext-1')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'mgr-ext-1' })).not.toBeInTheDocument();
  });
});
