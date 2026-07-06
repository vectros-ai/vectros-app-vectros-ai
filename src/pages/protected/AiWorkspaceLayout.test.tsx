// ---------------------------------------------------------------------------
// AiWorkspaceLayout tests — the sub-tab active-state logic (matched by path
// prefix) + the Outlet for the matched sub-route.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { useEffect, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';

import { AiWorkspaceLayout } from './AiWorkspaceLayout';
import { TestProviders } from '../../test/TestProviders';
import { CurrentContextProvider } from '../../auth/CurrentContextProvider';
import { useCurrentContext } from '../../auth';

const TENANT = 'tnt_0001';
// Two contexts in the same tenant — switching between them must remount the page.
const CTX1 = { contextId: 'ctx1', name: 'One', tenantId: TENANT, tenantKind: 'test' as const };
const CTX2 = { contextId: 'ctx2', name: 'Two', tenantId: TENANT, tenantKind: 'test' as const };

// Same-named context (`default`) in the two tenant kinds a user spans — the live
// and test tenants. These share a contextId but differ in tenant, so keying the
// remount on the contextId alone would NOT remount across a live↔test switch.
const LIVE_TENANT = 'tnt_live01';
const TEST_TENANT = 'tnt_test01';
const LIVE_DEFAULT = { contextId: 'default', name: 'Default', tenantId: LIVE_TENANT, tenantKind: 'live' as const };
const TEST_DEFAULT = { contextId: 'default', name: 'Default', tenantId: TEST_TENANT, tenantKind: 'test' as const };

function renderAt(path: string): void {
  render(
    <TestProviders initialEntries={[path]}>
      {/* The layout is a context-scoped section (runtime-gated by RequireContext);
          it reads the active context to remount its Outlet on a context switch. */}
      <CurrentContextProvider
        initialContexts={[{ contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' }]}
        initialContext="default"
      >
        <Routes>
          <Route path="/ai" element={<AiWorkspaceLayout />}>
            <Route path="chat" element={<div>chat outlet</div>} />
            <Route path="ask" element={<div>ask outlet</div>} />
          </Route>
        </Routes>
      </CurrentContextProvider>
    </TestProviders>,
  );
}

describe('AiWorkspaceLayout', () => {
  it('marks the Chat tab active on /ai/chat and renders its outlet', () => {
    renderAt('/ai/chat');
    expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Ask your data' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByText('chat outlet')).toBeInTheDocument();
  });

  it('marks the Ask tab active on /ai/ask and renders its outlet', () => {
    renderAt('/ai/ask');
    expect(screen.getByRole('tab', { name: 'Ask your data' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('ask outlet')).toBeInTheDocument();
  });

  it('remounts the active AI page on a context switch (clears cross-context state, AI1/AI2)', async () => {
    const user = userEvent.setup();
    let mounts = 0;
    function MountProbe(): React.JSX.Element {
      useEffect(() => {
        mounts += 1;
      }, []);
      return <div>chat outlet</div>;
    }
    function ContextSwitch(): React.JSX.Element {
      const { setContext } = useCurrentContext();
      return <button onClick={() => void setContext(CTX2)}>switch ctx</button>;
    }

    render(
      <TestProviders initialEntries={['/ai/chat']}>
        <CurrentContextProvider initialContexts={[CTX1, CTX2]} initialContext="ctx1">
          <ContextSwitch />
          <Routes>
            <Route path="/ai" element={<AiWorkspaceLayout />}>
              <Route path="chat" element={<MountProbe />} />
            </Route>
          </Routes>
        </CurrentContextProvider>
      </TestProviders>,
    );

    await screen.findByText('chat outlet');
    const afterInitial = mounts; // 1 (or 2 under StrictMode double-invoke)

    // Switching context must remount the keyed Outlet child (a fresh mount),
    // which is what clears the prior context's chat thread / grounded answer.
    await user.click(screen.getByRole('button', { name: 'switch ctx' }));
    await waitFor(() => expect(mounts).toBeGreaterThan(afterInitial));
  });

  it('remounts on a switch between same-named contexts across live ↔ test tenants', async () => {
    // The bug: keying the remount on the contextId alone. A user spans a live and
    // a test tenant, each with a `default` context. Switching live `default` →
    // test `default` keeps the same contextId, so a contextId-only key never
    // changes → no remount → the prior context's chat thread / grounded RAG
    // answer (component-local React state, NOT react-query cache) stays rendered
    // under the new context. That is display bleed on PHI. This asserts the fix:
    // the (tenant, context) key forces a fresh mount even when the id is identical.
    const user = userEvent.setup();
    let mounts = 0;
    function MountProbe(): React.JSX.Element {
      useEffect(() => {
        mounts += 1;
      }, []);
      return <div>chat outlet</div>;
    }
    function ContextSwitch(): React.JSX.Element {
      const { setContext } = useCurrentContext();
      // Switch to the SAME-NAMED `default` context in the other tenant kind.
      return <button onClick={() => void setContext(TEST_DEFAULT)}>switch tenant</button>;
    }

    render(
      <TestProviders initialEntries={['/ai/chat']}>
        <CurrentContextProvider
          initialContexts={[LIVE_DEFAULT, TEST_DEFAULT]}
          initialContext="default"
        >
          <ContextSwitch />
          <Routes>
            <Route path="/ai" element={<AiWorkspaceLayout />}>
              <Route path="chat" element={<MountProbe />} />
            </Route>
          </Routes>
        </CurrentContextProvider>
      </TestProviders>,
    );

    await screen.findByText('chat outlet');
    const afterInitial = mounts; // 1 (or 2 under StrictMode double-invoke)

    // The contextId is unchanged ('default' → 'default'); only the tenant differs.
    // With the contextId-only key this assertion fails (no remount). With the
    // (tenant, context) key the subtree unmounts + remounts, clearing the prior
    // tenant's chat thread / grounded answer.
    await user.click(screen.getByRole('button', { name: 'switch tenant' }));
    await waitFor(() => expect(mounts).toBeGreaterThan(afterInitial));
  });

  it('clears the AI page component-local state across a same-named live ↔ test switch', async () => {
    // Proves the CONSEQUENCE the remount exists for (not just that a remount
    // happens): a stand-in for the prior context's chat thread / grounded RAG
    // answer is held in component-local React state, and switching live `default`
    // → test `default` must wipe it. resetQueries clears the react-query cache but
    // NOT this local state, so the (tenant, context) key is the only thing that
    // can — this is the display-bleed-on-PHI guarantee, asserted directly.
    const user = userEvent.setup();
    function StatefulChild(): React.JSX.Element {
      const [answer, setAnswer] = useState('');
      return (
        <div>
          <span data-testid="local-state">{answer || 'empty'}</span>
          <button onClick={() => setAnswer('prior-context answer')}>seed answer</button>
        </div>
      );
    }
    function ContextSwitch(): React.JSX.Element {
      const { setContext } = useCurrentContext();
      return <button onClick={() => void setContext(TEST_DEFAULT)}>switch tenant</button>;
    }

    render(
      <TestProviders initialEntries={['/ai/chat']}>
        <CurrentContextProvider
          initialContexts={[LIVE_DEFAULT, TEST_DEFAULT]}
          initialContext="default"
        >
          <ContextSwitch />
          <Routes>
            <Route path="/ai" element={<AiWorkspaceLayout />}>
              <Route path="chat" element={<StatefulChild />} />
            </Route>
          </Routes>
        </CurrentContextProvider>
      </TestProviders>,
    );

    // Seed the local state under the live `default` context.
    await user.click(screen.getByRole('button', { name: 'seed answer' }));
    expect(screen.getByTestId('local-state')).toHaveTextContent('prior-context answer');

    // Switch to the same-named `default` context in the test tenant. Pre-fix
    // (contextId-only key) the subtree would be reused and the seeded answer
    // would bleed through; the (tenant, context) key forces a fresh mount.
    await user.click(screen.getByRole('button', { name: 'switch tenant' }));
    await waitFor(() => expect(screen.getByTestId('local-state')).toHaveTextContent('empty'));
  });
});
