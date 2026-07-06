// ---------------------------------------------------------------------------
// App route-table smoke tests.
//
// Verifies the two load-bearing wiring facts of the shell:
//   1. An unauthenticated visitor to `/` is redirected to the login page.
//   2. An authenticated visitor to `/` lands on the home page inside AppLayout.
//
// Auth state is controlled via the mock adapter's getCurrentUser (the probe
// AuthProvider runs on mount). We use findBy* to await the async probe settling
// (RequireAuth shows a spinner until then).
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import App from './App';
import { TestProviders } from './test/TestProviders';
import type { AuthUser } from '@vectros-ai/react';

const ALICE: AuthUser = {
  sub: 'sub-alice-0001',
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: 'Example',
};

describe('App routing', () => {
  it('redirects an unauthenticated visitor from / to the login page', async () => {
    render(
      <TestProviders initialEntries={['/']}>
        <App />
      </TestProviders>,
    );

    // The credentials form's submit button is the unambiguous login marker.
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('renders the home page for an authenticated visitor at /', async () => {
    render(
      <TestProviders
        initialEntries={['/']}
        authOverrides={{ getCurrentUser: vi.fn().mockResolvedValue(ALICE) }}
      >
        <App />
      </TestProviders>,
    );

    // HomePage greets by first name; AppLayout chrome (user menu) is also present.
    expect(await screen.findByRole('heading', { name: 'Welcome, Alice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open user menu' })).toBeInTheDocument();
  });

  it('renders the 404 page for an unknown route', async () => {
    render(
      <TestProviders initialEntries={['/no-such-route']}>
        <App />
      </TestProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
