// ---------------------------------------------------------------------------
// useActiveContextId / useActiveTenantId tests — the loud guards for
// context-scoped pages.
//
// Return the active context id + its tenant behind the gate; throw when rendered
// outside it (a wiring bug) rather than silently minting a token for a null
// (tenant, context).
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CurrentContextContext, useActiveContextId, useActiveTenantId } from './useCurrentContext';
import type { CurrentContextValue } from './useCurrentContext';

function ActiveContextProbe(): React.JSX.Element {
  return <span>{useActiveContextId()}</span>;
}

function ActiveTenantProbe(): React.JSX.Element {
  return <span>{useActiveTenantId()}</span>;
}

function value(context: string | null): CurrentContextValue {
  return {
    context,
    // The active tenant rides with the active context (set together).
    activeTenantId: context ? 'tnt_0001' : null,
    setContext: async () => undefined,
    contexts: [],
    loading: false,
    error: false,
    switching: false,
  };
}

describe('useActiveContextId', () => {
  it('returns the active context id when one is set', () => {
    render(
      <CurrentContextContext.Provider value={value('default')}>
        <ActiveContextProbe />
      </CurrentContextContext.Provider>,
    );
    expect(screen.getByText('default')).toBeInTheDocument();
  });

  it('throws when there is no active context (rendered outside the gate)', () => {
    // The hook throws during render; suppress React's expected error logging.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<ActiveContextProbe />)).toThrow(/no active context/i);
    spy.mockRestore();
  });
});

describe('useActiveTenantId (data-plane override)', () => {
  it("returns the active context's tenant when one is set", () => {
    render(
      <CurrentContextContext.Provider value={value('default')}>
        <ActiveTenantProbe />
      </CurrentContextContext.Provider>,
    );
    expect(screen.getByText('tnt_0001')).toBeInTheDocument();
  });

  it('throws when there is no active context (rendered outside the gate)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<ActiveTenantProbe />)).toThrow(/no active context tenant/i);
    spy.mockRestore();
  });
});
