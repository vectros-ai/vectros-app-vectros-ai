// ---------------------------------------------------------------------------
// OwnershipScopeFilter tests — the `scopeFilterParam` guard (only well-formed
// filters reach the wire) and the invalid-input affordance.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { OwnershipScopeFilter, scopeFilterParam } from './OwnershipScopeFilter';
import { TestProviders } from '../test/TestProviders';

describe('scopeFilterParam', () => {
  it('returns the trimmed filter only when well-formed', () => {
    expect(scopeFilterParam('group:eng-team')).toBe('group:eng-team');
    expect(scopeFilterParam('  org:org_1  ')).toBe('org:org_1');
  });

  it('returns undefined for empty / half-typed / reserved / whitespace-in-value', () => {
    expect(scopeFilterParam('')).toBeUndefined();
    expect(scopeFilterParam('   ')).toBeUndefined();
    expect(scopeFilterParam('group')).toBeUndefined(); // no value yet
    expect(scopeFilterParam('group:')).toBeUndefined();
    expect(scopeFilterParam('tenant:x')).toBeUndefined(); // reserved namespace
    expect(scopeFilterParam('org:abc def')).toBeUndefined(); // whitespace in value
  });
});

describe('OwnershipScopeFilter', () => {
  it('shows the help text (no error) when empty', () => {
    render(
      <TestProviders>
        <OwnershipScopeFilter value="" onChange={vi.fn()} />
      </TestProviders>,
    );
    expect(screen.queryByText(/use namespace:value/i)).not.toBeInTheDocument();
    expect(screen.getByText(/filter by owner/i)).toBeInTheDocument();
  });

  it('flags a malformed value', () => {
    render(
      <TestProviders>
        <OwnershipScopeFilter value="group" onChange={vi.fn()} />
      </TestProviders>,
    );
    expect(screen.getByText(/use namespace:value/i)).toBeInTheDocument();
  });

  it('reports raw typed text to the host (controlled by the host)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TestProviders>
        <OwnershipScopeFilter value="" onChange={onChange} />
      </TestProviders>,
    );
    await user.type(screen.getByRole('textbox', { name: /owner scope/i }), 'g');
    expect(onChange).toHaveBeenCalledWith('g');
  });
});
