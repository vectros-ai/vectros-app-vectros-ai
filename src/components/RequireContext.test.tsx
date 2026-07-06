// ---------------------------------------------------------------------------
// RequireContext tests — the data-route context gate's three branches.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

import { RequireContext } from './RequireContext';
import { CurrentContextContext } from '../auth/useCurrentContext';
import type { CurrentContextValue } from '../auth/useCurrentContext';
import { IntlProvider, I18N_DEFAULT_LOCALE } from '../i18n/IntlProvider';

function value(over: Partial<CurrentContextValue>): CurrentContextValue {
  return {
    context: null,
    activeTenantId: null,
    setContext: async () => undefined,
    contexts: [],
    loading: false,
    error: false,
    switching: false,
    ...over,
  };
}

function renderGate(ctx: CurrentContextValue): void {
  render(
    <IntlProvider locale={I18N_DEFAULT_LOCALE}>
      <MemoryRouter initialEntries={['/records']}>
        <CurrentContextContext.Provider value={ctx}>
          <Routes>
            <Route element={<RequireContext />}>
              <Route path="/records" element={<div>records-content</div>} />
            </Route>
          </Routes>
        </CurrentContextContext.Provider>
      </MemoryRouter>
    </IntlProvider>,
  );
}

describe('RequireContext', () => {
  it('shows a spinner while contexts are loading', () => {
    renderGate(value({ loading: true }));
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('records-content')).not.toBeInTheDocument();
  });

  it('shows a gate notice when no context is active', () => {
    renderGate(value({ context: null, loading: false }));
    expect(screen.getByText('No data context yet')).toBeInTheDocument();
    expect(screen.queryByText('records-content')).not.toBeInTheDocument();
  });

  it('shows an error notice (not the empty state) when enumeration failed', () => {
    renderGate(value({ context: null, loading: false, error: true }));
    expect(screen.getByText(/couldn.t load your contexts/i)).toBeInTheDocument();
    expect(screen.queryByText('No data context yet')).not.toBeInTheDocument();
    expect(screen.queryByText('records-content')).not.toBeInTheDocument();
  });

  it('renders the routed page once a context is active', () => {
    renderGate(value({ context: 'default' }));
    expect(screen.getByText('records-content')).toBeInTheDocument();
  });
});
