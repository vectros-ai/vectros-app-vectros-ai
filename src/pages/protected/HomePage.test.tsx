// ---------------------------------------------------------------------------
// HomePage tests — the data-plane landing page renders the signed-in identity.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { HomePage } from './HomePage';
import { TestProviders } from '../../test/TestProviders';
import type { AuthUser } from '@vectros-ai/react';

const ALICE: AuthUser = {
  sub: 'sub-alice-0001',
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: 'Example',
};

describe('HomePage', () => {
  it('greets the signed-in user and surfaces their identity', async () => {
    render(
      <TestProviders authOverrides={{ getCurrentUser: vi.fn().mockResolvedValue(ALICE) }}>
        <HomePage />
      </TestProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Welcome, Alice' })).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('sub-alice-0001')).toBeInTheDocument();
  });

  it('renders a soft placeholder when no user is loaded', () => {
    // HomePage renders inside RequireAuth at runtime, but guards against a null
    // user defensively — assert it does not throw and shows the placeholder.
    render(
      <TestProviders>
        <HomePage />
      </TestProviders>,
    );

    expect(screen.getByText('…')).toBeInTheDocument();
  });
});
