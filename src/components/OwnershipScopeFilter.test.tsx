// ---------------------------------------------------------------------------
// OwnershipScopeFilter tests — the `scopeFilterParam` guard (only well-formed
// filters reach the wire) and the invalid-input affordance.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { OwnershipScopeFilter, scopeFilterParam } from './OwnershipScopeFilter';
import { MAX_SCOPE_FILTERS } from '../lib/ownershipScopes';
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

  // `allowMultiple` swaps BOTH the validator and the whole `*Multi` message
  // family. Nothing else in the suite renders it, so without these cells a
  // missing or mis-suffixed id would render the raw id string to the user and
  // every test would still pass (this app has no i18n key-completeness check).
  describe('allowMultiple', () => {
    it('accepts several dimensions and shows the multi help text, not a raw message id', () => {
      render(
        <TestProviders>
          <OwnershipScopeFilter value="org:acme, client:pilot" onChange={vi.fn()} allowMultiple />
        </TestProviders>,
      );
      expect(
        screen.getByText(
          new RegExp(`separate up to ${MAX_SCOPE_FILTERS} dimensions with commas`, 'i'),
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/ownershipScope\./)).not.toBeInTheDocument();
    });

    // Each failure has a DIFFERENT fix, so each gets its own message and the
    // three are distinguishable on screen. They previously collapsed into one
    // sentence, which hid which rule was broken and forced the cap to be
    // restated as a literal beside `MAX_SCOPE_FILTERS`.
    it('names the duplicated namespace — otherwise the filter is silently dropped', () => {
      // The failure this guards: an unusable multi-filter yields NO ownership
      // narrowing at all, so the results silently widen. The error state is the
      // only thing telling the user their filter is not being applied.
      render(
        <TestProviders>
          <OwnershipScopeFilter value="org:a, org:b" onChange={vi.fn()} allowMultiple />
        </TestProviders>,
      );
      expect(screen.getByText(/“org” is named more than once/i)).toBeInTheDocument();
    });

    it('reports the cap from the shared constant, not a second copy of the number', () => {
      const tooMany = Array.from({ length: MAX_SCOPE_FILTERS + 1 }, (_, i) => `ns${i}:v`).join(', ');
      render(
        <TestProviders>
          <OwnershipScopeFilter value={tooMany} onChange={vi.fn()} allowMultiple />
        </TestProviders>,
      );
      expect(
        screen.getByText(new RegExp(`at most ${MAX_SCOPE_FILTERS}`, 'i')),
      ).toBeInTheDocument();
    });

    it('quotes the offending entry when one is malformed', () => {
      render(
        <TestProviders>
          <OwnershipScopeFilter value="org:acme, nope" onChange={vi.fn()} allowMultiple />
        </TestProviders>,
      );
      expect(screen.getByText(/“nope” isn’t a valid namespace:value/i)).toBeInTheDocument();
    });

    it('does NOT accept a comma-separated value when the host has not opted in', () => {
      // The single-dimension pages (records/documents lists) take only `scope`.
      // Pairing `allowMultiple` with the wrong param helper is the live trap;
      // this pins the default to the single-dimension validator.
      render(
        <TestProviders>
          <OwnershipScopeFilter value="org:acme, client:pilot" onChange={vi.fn()} />
        </TestProviders>,
      );
      expect(screen.getByText(/use namespace:value, e\.g\./i)).toBeInTheDocument();
    });
  });
});
