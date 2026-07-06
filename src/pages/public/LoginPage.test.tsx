// ---------------------------------------------------------------------------
// LoginPage tests — the sign-in state machine.
//
// Covers: credentials → MFA stage transition; credentials → COMPLETE navigates
// to the intended destination; an account-setup outcome surfaces the admin-app
// hand-off message; a thrown adapter error renders inline.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';

import { LoginPage } from './LoginPage';
import { TestProviders } from '../../test/TestProviders';

async function fillCredentials(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  // Regex (not exact string): MUI appends a ` *` asterisk to a `required`
  // field's accessible label, so the computed label is "Email address *".
  // findByLabelText (not getBy): the page shows a spinner while the initial
  // session probe is in flight, so the form mounts a tick after render.
  await user.type(await screen.findByLabelText(/email address/i), 'alice@example.com');
  await user.type(screen.getByLabelText(/^password/i), 'hunter2pass');
}

describe('LoginPage', () => {
  it('transitions to the MFA stage when sign-in requires a code', async () => {
    const user = userEvent.setup();
    const signIn = vi.fn().mockResolvedValue({ kind: 'MFA_REQUIRED', methods: ['TOTP'] });

    render(
      <TestProviders authOverrides={{ signIn }}>
        <LoginPage />
      </TestProviders>,
    );

    await fillCredentials(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Two-factor authentication' }),
    ).toBeInTheDocument();
    expect(signIn).toHaveBeenCalledWith({ email: 'alice@example.com', password: 'hunter2pass' });
  });

  it('navigates to the intended destination on a complete sign-in', async () => {
    const user = userEvent.setup();
    const signIn = vi.fn().mockResolvedValue({ kind: 'COMPLETE' });

    render(
      <TestProviders initialEntries={['/login']} authOverrides={{ signIn }}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>home-sentinel</div>} />
        </Routes>
      </TestProviders>,
    );

    await fillCredentials(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('home-sentinel')).toBeInTheDocument();
  });

  it('directs the user to finish account setup in the admin app', async () => {
    const user = userEvent.setup();
    const signIn = vi.fn().mockResolvedValue({ kind: 'CONFIRMATION_REQUIRED' });

    render(
      <TestProviders authOverrides={{ signIn }}>
        <LoginPage />
      </TestProviders>,
    );

    await fillCredentials(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/admin app/i);
  });

  it('renders an inline error when sign-in throws', async () => {
    const user = userEvent.setup();
    const signIn = vi.fn().mockRejectedValue(new Error('network down'));

    render(
      <TestProviders authOverrides={{ signIn }}>
        <LoginPage />
      </TestProviders>,
    );

    await fillCredentials(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    // A real localized message, NOT a raw `auth.errors.*` id (regression guard
    // for a missing catalog entry — a non-AuthError maps to UNKNOWN).
    expect(alert).toHaveTextContent(/something went wrong/i);
    expect(alert).not.toHaveTextContent('auth.errors');
  });

  it('redirects to home when a valid session already exists (no form shown)', async () => {
    // A signed-in user landing on /login should be sent home rather than shown
    // the form — submitting credentials while already authenticated would be
    // rejected by the auth provider. getCurrentUser resolving a user makes the
    // AuthProvider report isAuthenticated.
    const aliceUser = { sub: 'sub-1', email: 'alice@example.com', firstName: 'Alice', lastName: 'Smith' };
    render(
      <TestProviders
        initialEntries={['/login']}
        authOverrides={{ getCurrentUser: vi.fn().mockResolvedValue(aliceUser) }}
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>home-sentinel</div>} />
        </Routes>
      </TestProviders>,
    );

    expect(await screen.findByText('home-sentinel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('redirects an already-signed-in user to their original deep-link destination', async () => {
    // RequireAuth bounces an unauthenticated deep-link to /login carrying the
    // intended path in `location.state.from`. If the session is in fact still
    // valid, /login must honor that `from` and land the user on the page they
    // asked for — not flatten every redirect to home.
    const aliceUser = { sub: 'sub-1', email: 'alice@example.com', firstName: 'Alice', lastName: 'Smith' };
    render(
      <TestProviders
        initialEntries={[{ pathname: '/login', state: { from: { pathname: '/records/widget' } } }]}
        authOverrides={{ getCurrentUser: vi.fn().mockResolvedValue(aliceUser) }}
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>home-sentinel</div>} />
          <Route path="/records/widget" element={<div>deep-link-sentinel</div>} />
        </Routes>
      </TestProviders>,
    );

    expect(await screen.findByText('deep-link-sentinel')).toBeInTheDocument();
    expect(screen.queryByText('home-sentinel')).not.toBeInTheDocument();
  });
});
