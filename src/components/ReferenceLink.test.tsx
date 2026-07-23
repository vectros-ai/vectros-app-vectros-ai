// ---------------------------------------------------------------------------
// ReferenceLink — the reference cross-link resolution UX. Resolves a
// reference value to its target record via lookupRecordsByBody and renders a link;
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
  lookupRecordsByBody: (req: { type: string; field: string; value: string }) => Promise<unknown>,
): void {
  mockedClient.mockReturnValue({ records: { lookupRecordsByBody } } as never);
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
    const lookupRecordsByBody = vi
      .fn()
      .mockResolvedValue(pageOf([{ id: 'emp_99', typeName: 'employee' }]));
    stubLookup(lookupRecordsByBody);

    renderLink();

    const link = await screen.findByRole('link', { name: 'mgr-ext-1' });
    expect(link).toHaveAttribute('href', '/records/emp_99');
    expect(lookupRecordsByBody).toHaveBeenCalledWith({
      type: 'employee',
      field: 'externalId',
      value: 'mgr-ext-1',
    });
  });

  it('resolves through the POST-body lookup, never the GET variant', async () => {
    // A reference whose target field is SENSITIVE can only be resolved through
    // the body form — the GET variant rejects it with a 400 because the value
    // would ride the URL query string. Calling the GET form left every such
    // reference permanently unresolved (rendered as raw text, no link), so the
    // method identity here IS the fix: assert the GET form is never reachable.
    const lookupRecordsByBody = vi
      .fn()
      .mockResolvedValue(pageOf([{ id: 'emp_42', typeName: 'employee' }]));
    const lookupRecords = vi.fn(() => {
      throw new Error('the GET lookup 400s for a sensitive field — must not be called');
    });
    mockedClient.mockReturnValue({
      records: { lookupRecordsByBody, lookupRecords },
    } as never);

    renderLink({ targetTypeName: 'employee', targetField: 'ssn', value: '123-45-6789' });

    const link = await screen.findByRole('link', { name: '123-45-6789' });
    expect(link).toHaveAttribute('href', '/records/emp_42');
    expect(lookupRecordsByBody).toHaveBeenCalledWith({
      type: 'employee',
      field: 'ssn',
      value: '123-45-6789',
    });
    expect(lookupRecords).not.toHaveBeenCalled();
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
