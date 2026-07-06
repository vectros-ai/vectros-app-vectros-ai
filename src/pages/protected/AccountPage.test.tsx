// ---------------------------------------------------------------------------
// AccountPage tests — the account/security hand-off to the admin app.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AccountPage } from './AccountPage';
import { TestProviders } from '../../test/TestProviders';
import { BRAND } from '../../brand';

describe('AccountPage', () => {
  it('explains account management lives in the admin app and links to it', () => {
    render(
      <TestProviders>
        <AccountPage />
      </TestProviders>,
    );

    expect(screen.getByRole('heading', { name: 'Account & security' })).toBeInTheDocument();

    const cta = screen.getByRole('link', { name: 'Open the admin app' });
    expect(cta).toHaveAttribute('href', BRAND.adminAppUrl);
    // Opens in a new tab with a safe rel (separate origin; preserve this session).
    expect(cta).toHaveAttribute('target', '_blank');
    expect(cta).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});
