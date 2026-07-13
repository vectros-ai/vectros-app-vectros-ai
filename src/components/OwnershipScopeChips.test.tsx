// ---------------------------------------------------------------------------
// OwnershipScopeChips tests — the three display branches.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { OwnershipScopeChips } from './OwnershipScopeChips';
import { TestProviders } from '../test/TestProviders';

function renderChips(scopes: readonly string[] | undefined): void {
  render(
    <TestProviders>
      <OwnershipScopeChips scopes={scopes} />
    </TestProviders>,
  );
}

describe('OwnershipScopeChips', () => {
  it('renders a chip per namespace:value entry', () => {
    renderChips(['org:org_acme', 'group:eng-team']);
    expect(screen.getByText('org:org_acme')).toBeInTheDocument();
    expect(screen.getByText('group:eng-team')).toBeInTheDocument();
  });

  it('renders "Private" for an empty scopes array', () => {
    renderChips([]);
    expect(screen.getByText(/private \(you only\)/i)).toBeInTheDocument();
  });

  it('renders an em dash for undefined scopes', () => {
    renderChips(undefined);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
