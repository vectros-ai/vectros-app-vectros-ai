// ---------------------------------------------------------------------------
// NoDataContextNotice tests — role-aware empty-state guidance.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { IntlProvider, I18N_DEFAULT_LOCALE } from '../i18n/IntlProvider';

// The notice reads the caller's role from useCurrentTenant. Mock the app's auth
// re-export module to drive role without standing up the tenant/auth providers.
const mockUseCurrentTenant = vi.hoisted(() => vi.fn());
vi.mock('../auth', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vitest's importOriginal idiom
  const actual = await importOriginal<typeof import('../auth')>();
  return { ...actual, useCurrentTenant: mockUseCurrentTenant };
});

import { NoDataContextNotice } from './NoDataContextNotice';
import { BRAND } from '../brand';

function tenantValue(role: string | null) {
  return {
    tenant: role ? 'tnt_1' : null,
    setTenant: async () => undefined,
    memberships: [],
    loading: false,
    activeMembership: role
      ? { tenantId: 'tnt_1', tenantName: 'Acme', tenantKind: 'live', role, status: 'ACTIVE', partnerId: 'p1' }
      : null,
  };
}

function renderNotice(props: { homeAction?: boolean } = {}): void {
  render(
    <IntlProvider locale={I18N_DEFAULT_LOCALE}>
      <MemoryRouter>
        <NoDataContextNotice {...props} />
      </MemoryRouter>
    </IntlProvider>,
  );
}

describe('NoDataContextNotice', () => {
  it('points an OWNER at the admin app to provision a context', () => {
    mockUseCurrentTenant.mockReturnValue(tenantValue('OWNER'));
    renderNotice();
    expect(screen.getByText('No data context yet')).toBeInTheDocument();
    expect(screen.getByText(/create and manage data contexts in the admin app/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /open the admin app/i });
    expect(link).toHaveAttribute('href', BRAND.adminAppUrl);
  });

  it('tells a SUB_USER to ask an administrator — no admin-app link', () => {
    mockUseCurrentTenant.mockReturnValue(tenantValue('SUB_USER'));
    renderNotice();
    expect(screen.getByText('No data context yet')).toBeInTheDocument();
    expect(screen.getByText(/ask an administrator/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open the admin app/i })).not.toBeInTheDocument();
  });

  it('renders a back-home action only when homeAction is set', () => {
    mockUseCurrentTenant.mockReturnValue(tenantValue('SUB_USER'));
    renderNotice({ homeAction: true });
    expect(screen.getByRole('link', { name: /go to home/i })).toBeInTheDocument();
  });
});
