// ---------------------------------------------------------------------------
// ContextSwitcher tests — visibility rules + the switch interaction.
//
// Uses CurrentContextProvider's test seeds (initialContexts / initialContext)
// to drive the switcher without the async enumeration. TestProviders supplies
// the AuthProvider / QueryClient / Intl the provider + control read at render.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';

import type * as VectrosReact from '@vectros-ai/react';

// No-op the token-cache clear so a switch doesn't touch real module state.
vi.mock('@vectros-ai/react', async (importOriginal) => {
  const actual = await importOriginal<typeof VectrosReact>();
  return { ...actual, clearVectrosApiTokenCache: vi.fn() };
});

import { ContextSwitcher } from './ContextSwitcher';
import { CurrentContextProvider } from '../auth/CurrentContextProvider';
import type { AppContextOption } from '../auth/useCurrentContext';
import { TestProviders } from '../test/TestProviders';

// The basic MVP scenario: the SAME `default` context in both the live and test
// tenant. Same contextId, different tenants — so options are disambiguated by
// (tenant, context) and labelled by kind (Live/Test).
const TWO: ReadonlyArray<AppContextOption> = [
  { contextId: 'default', name: 'Default', tenantId: 'tnt_live', tenantKind: 'live' },
  { contextId: 'default', name: 'Default', tenantId: 'tnt_test', tenantKind: 'test' },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ContextSwitcher', () => {
  it('renders a dropdown of the reachable contexts and switches on selection', async () => {
    const user = userEvent.setup();
    render(
      <TestProviders>
        <CurrentContextProvider initialContexts={TWO} initialContext="default">
          <ContextSwitcher />
        </CurrentContextProvider>
      </TestProviders>,
    );

    // Initial selection is the first `default` (the live tenant), kind-labelled.
    const combo = screen.getByRole('combobox', { name: 'Active context' });
    expect(combo).toHaveTextContent('Default · Live');

    await user.click(combo);
    // Both tenants' default appear, disambiguated by kind. Switch to Test.
    await user.click(await screen.findByRole('option', { name: 'Default · Test' }));

    // setContext updated provider state (same contextId, different tenant) →
    // the control reflects the test-tenant default.
    expect(
      await screen.findByRole('combobox', { name: 'Active context' }),
    ).toHaveTextContent('Default · Test');
  });

  it('appends the context id ONLY to options whose display name collides', async () => {
    const user = userEvent.setup();
    // Two contexts that share a display name AND tenant kind → the "name · kind"
    // label collides, so each gets its id appended to stay distinguishable.
    const DUP: ReadonlyArray<AppContextOption> = [
      { contextId: 'app-one', name: 'My App', tenantId: 'tnt_live', tenantKind: 'live' },
      { contextId: 'app-two', name: 'My App', tenantId: 'tnt_live', tenantKind: 'live' },
    ];
    render(
      <TestProviders>
        <CurrentContextProvider initialContexts={DUP} initialContext="app-one">
          <ContextSwitcher />
        </CurrentContextProvider>
      </TestProviders>,
    );

    const combo = screen.getByRole('combobox', { name: 'Active context' });
    expect(combo).toHaveTextContent('My App · Live (app-one)');

    await user.click(combo);
    expect(
      await screen.findByRole('option', { name: 'My App · Live (app-two)' }),
    ).toBeInTheDocument();
  });

  it('collapses to a static label when only one context is reachable', () => {
    render(
      <TestProviders>
        <CurrentContextProvider
          initialContexts={[
            { contextId: 'default', name: 'Default', tenantId: 'tnt_test', tenantKind: 'test' },
          ]}
          initialContext="default"
        >
          <ContextSwitcher />
        </CurrentContextProvider>
      </TestProviders>,
    );

    // No interactive dropdown — just the label, still kind-tagged so the user
    // knows which tenant they're in.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Default · Test')).toBeInTheDocument();
  });

  it('renders nothing when there are no reachable contexts', () => {
    const { container } = render(
      <TestProviders>
        <CurrentContextProvider initialContexts={[]}>
          <ContextSwitcher />
        </CurrentContextProvider>
      </TestProviders>,
    );

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent('Active context');
  });

  it('disables the switcher while a switch is in flight (no second concurrent re-mint)', async () => {
    // Hold the switch open by making resetQueries never resolve — setContext
    // sets switching=true and awaits it, so the Select stays disabled. This pins
    // the guard against a user firing a second swap (which would clear the cache +
    // re-mint twice, racing two token mints) mid-switch.
    const user = userEvent.setup();
    vi.spyOn(QueryClient.prototype, 'resetQueries').mockReturnValue(
      new Promise<void>(() => undefined),
    );

    render(
      <TestProviders>
        <CurrentContextProvider initialContexts={TWO} initialContext="default">
          <ContextSwitcher />
        </CurrentContextProvider>
      </TestProviders>,
    );

    const combo = screen.getByRole('combobox', { name: 'Active context' });
    expect(combo).not.toHaveAttribute('aria-disabled', 'true');

    await user.click(combo);
    await user.click(await screen.findByRole('option', { name: 'Default · Test' }));

    // The in-flight switch leaves the combobox disabled until it resolves.
    await waitFor(() => {
      expect(
        screen.getByRole('combobox', { name: 'Active context' }),
      ).toHaveAttribute('aria-disabled', 'true');
    });
  });
});
