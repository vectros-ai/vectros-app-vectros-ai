// ---------------------------------------------------------------------------
// VersionHistory tests — ordering (newest first), the field-diff summary, and
// the empty state. The SDK types ModelDataVersionResponse; we cast minimal
// fixtures to that shape via `as never` to keep the fixtures readable.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { VersionHistory } from './VersionHistory';
import type { VersionEntry } from '../api/vectrosApi';
import { TestProviders } from '../test/TestProviders';

function v(entry: Partial<VersionEntry>): VersionEntry {
  return entry as VersionEntry;
}

describe('VersionHistory', () => {
  it('renders an empty-state message when there are no versions', () => {
    render(
      <TestProviders>
        <VersionHistory versions={[]} />
      </TestProviders>,
    );
    expect(screen.getByText(/no history yet/i)).toBeInTheDocument();
  });

  it('orders rows newest-first by createdAt and shows the change types', () => {
    render(
      <TestProviders>
        <VersionHistory
          versions={[
            v({ id: 'a', changeType: 'CREATE', createdAt: '2026-06-01T00:00:00Z' }),
            v({ id: 'b', changeType: 'UPDATE', createdAt: '2026-06-09T00:00:00Z' }),
          ]}
        />
      </TestProviders>,
    );
    const labels = screen.getAllByText(/Created|Updated/).map((el) => el.textContent);
    // Newest (Updated, Jun 9) precedes oldest (Created, Jun 1).
    expect(labels).toEqual(['Updated', 'Created']);
  });

  it('summarizes the changed field names', () => {
    render(
      <TestProviders>
        <VersionHistory
          versions={[
            v({
              id: 'a',
              changeType: 'UPDATE',
              createdAt: '2026-06-09T00:00:00Z',
              changedFields: { fields: ['status', 'assignee'] },
            }),
          ]}
        />
      </TestProviders>,
    );
    expect(screen.getByText(/Changed: status, assignee/)).toBeInTheDocument();
  });

  // The defining invariant: the component renders field NAMES, never the prior
  // state snapshot or per-field VALUES — so even non-redacted prior content can't
  // leak through the history view.
  it('never renders previousContent or per-field detail values (PHI defense)', () => {
    render(
      <TestProviders>
        <VersionHistory
          versions={[
            v({
              id: 'a',
              changeType: 'UPDATE',
              createdAt: '2026-06-09T00:00:00Z',
              previousContent: JSON.stringify({ payload: { ssn: 'SECRET-PRIOR-VALUE' } }),
              changedFields: {
                fields: ['ssn'],
                details: { ssn: { from: 'SECRET-OLD', to: 'SECRET-NEW' } },
              } as never,
            }),
          ]}
        />
      </TestProviders>,
    );
    // The field NAME is shown...
    expect(screen.getByText(/Changed: ssn/)).toBeInTheDocument();
    // ...but no value from previousContent or changedFields.details reaches the DOM.
    expect(screen.queryByText(/SECRET-PRIOR-VALUE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SECRET-OLD/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SECRET-NEW/)).not.toBeInTheDocument();
  });

  it('shows a "more history exists" caption only when hasMore', () => {
    const versions = [v({ id: 'a', changeType: 'CREATE', createdAt: '2026-06-09T00:00:00Z' })];
    const { rerender } = render(
      <TestProviders>
        <VersionHistory versions={versions} hasMore />
      </TestProviders>,
    );
    expect(screen.getByText(/earlier history exists/i)).toBeInTheDocument();

    rerender(
      <TestProviders>
        <VersionHistory versions={versions} />
      </TestProviders>,
    );
    expect(screen.queryByText(/earlier history exists/i)).not.toBeInTheDocument();
  });

  it('names the agent and the run for a change an agent run made, and nothing for a person', () => {
    render(
      <TestProviders>
        <VersionHistory
          versions={[
            v({
              id: 'a',
              changeType: 'CREATE',
              createdAt: '2026-06-01T00:00:00Z',
              changedBy: 'user:usr_manager',
              actingVia: { kind: 'agent-run', actorId: 'agt_1', runId: 'run_9', tool: 'records_create' },
            }),
            v({ id: 'b', changeType: 'UPDATE', createdAt: '2026-06-09T00:00:00Z', changedBy: 'user:usr_manager' }),
          ]}
        />
      </TestProviders>,
    );
    const via = screen.getAllByTestId('history-acting-via');
    expect(via).toHaveLength(1);
    expect(via[0]?.textContent).toBe('via agent agt_1 · run run_9');
    expect(via[0]?.getAttribute('title')).toBe('records_create');
  });

  it('still shows an execution kind it does not know, by its own name', () => {
    render(
      <TestProviders>
        <VersionHistory
          versions={[
            v({
              id: 'a',
              changeType: 'UPDATE',
              createdAt: '2026-06-01T00:00:00Z',
              actingVia: { kind: 'workflow', actorId: 'wf_1', runId: 'inst_1/step_2' },
            }),
          ]}
        />
      </TestProviders>,
    );
    expect(screen.getByTestId('history-acting-via').textContent).toBe('via workflow wf_1 / inst_1/step_2');
  });
});
