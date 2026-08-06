// ---------------------------------------------------------------------------
// LookupPanel tests — field selection, mode gating, Apply/Clear, and a
// composite lookup field (fieldNames set, fieldName absent): offered by its
// joined identity, rendered as one value input per declared leg (in
// declaration order), never offered a range/prefix mode, and submitted as
// `{ field: 'status,area', values: [...] }` — never a single `value`.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LookupPanel } from './LookupPanel';
import type { AppliedLookup, LookupFieldDef } from './LookupPanel';
import { TestProviders } from '../test/TestProviders';

function renderPanel(
  defs: ReadonlyArray<LookupFieldDef>,
  onApply: (lookup: AppliedLookup | null) => void,
  opts: { supportsSortWindow?: boolean } = {},
): void {
  // A thin stateful wrapper: the real pages own `applied` and feed it back in,
  // which is what lets Clear (rendered only once something is applied) show up.
  function Harness(): React.JSX.Element {
    const [applied, setApplied] = useState<AppliedLookup | null>(null);
    return (
      <LookupPanel
        defs={defs}
        applied={applied}
        onApply={(l) => {
          setApplied(l);
          onApply(l);
        }}
        messagePrefix="records"
        idPrefix="test"
        supportsSortWindow={opts.supportsSortWindow ?? false}
      />
    );
  }
  render(
    <TestProviders>
      <Harness />
    </TestProviders>,
  );
}

// A composite is equality-only over its legs with an ordered sort key — the
// API refuses `rangeEnabled` on one at declare time, so `rangeEnabled` is
// always false here; there is no rangeEnabled composite shape to construct.
const COMPOSITE: LookupFieldDef = { fieldNames: ['status', 'area'], rangeEnabled: false };
const PLAIN: LookupFieldDef = { fieldName: 'owner', rangeEnabled: false };
const PLAIN_RANGE: LookupFieldDef = { fieldName: 'code', rangeEnabled: true };
// sortBy omitted (undefined) defaults to `createdAt` server-side — known
// units (epoch ms), so the sort-key window is offered for these.
const PLAIN_CUSTOM_SORT: LookupFieldDef = { fieldName: 'owner', rangeEnabled: false, sortBy: 'priority' };

describe('LookupPanel — composite lookup fields', () => {
  it('offers a composite by its joined identity', async () => {
    const user = userEvent.setup();
    renderPanel([COMPOSITE, PLAIN], vi.fn());

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    expect(await screen.findByRole('option', { name: 'status,area' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'owner' })).toBeInTheDocument();
  });

  it('renders one value input per declared leg, in declaration order, and never a Match selector', async () => {
    const user = userEvent.setup();
    renderPanel([COMPOSITE], vi.fn());

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'status,area' }));

    expect(await screen.findByRole('textbox', { name: 'status' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'area' })).toBeInTheDocument();
    // Equality-only — a composite is never range-enabled (server-refused at
    // declare time), so no Match mode selector and no plain "Value" field.
    expect(screen.queryByRole('combobox', { name: 'Match' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Value' })).not.toBeInTheDocument();
  });

  it('disables Look up until every leg has a value', async () => {
    const user = userEvent.setup();
    renderPanel([COMPOSITE], vi.fn());

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'status,area' }));

    const applyButton = screen.getByRole('button', { name: 'Look up' });
    expect(applyButton).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: 'status' }), 'open');
    expect(applyButton).toBeDisabled(); // one of two legs filled — still not ready

    await user.type(screen.getByRole('textbox', { name: 'area' }), 'billing');
    expect(applyButton).toBeEnabled();
  });

  it('submits field + values (one per leg, declared order) — never a single value', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    renderPanel([COMPOSITE], onApply);

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'status,area' }));
    await user.type(screen.getByRole('textbox', { name: 'status' }), 'open');
    await user.type(screen.getByRole('textbox', { name: 'area' }), 'billing');
    await user.click(screen.getByRole('button', { name: 'Look up' }));

    expect(onApply).toHaveBeenCalledWith({
      field: 'status,area',
      order: 'asc',
      mode: 'multi',
      values: ['open', 'billing'],
    });
  });

  it('clears per-leg values when switching away from a composite, and vice versa', async () => {
    const user = userEvent.setup();
    renderPanel([COMPOSITE, PLAIN], vi.fn());

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'status,area' }));
    await user.type(screen.getByRole('textbox', { name: 'status' }), 'open');

    // Switch to the plain field — the composite's leg inputs (and their
    // values) must not survive the switch.
    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'owner' }));
    expect(screen.queryByRole('textbox', { name: 'status' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveValue('');

    // And back — the composite's legs start empty again, not re-showing 'open'.
    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'status,area' }));
    expect(screen.getByRole('textbox', { name: 'status' })).toHaveValue('');
  });
});

describe('LookupPanel — plain-field selection, mode gating, Apply/Clear', () => {
  it('selects a plain field and submits an exact lookup', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    renderPanel([PLAIN], onApply);

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'owner' }));
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'acme');
    await user.click(screen.getByRole('button', { name: 'Look up' }));

    expect(onApply).toHaveBeenCalledWith({
      field: 'owner',
      order: 'asc',
      mode: 'exact',
      value: 'acme',
    });
  });

  it('offers Match mode only for a range-enabled field, not a plain one', async () => {
    const user = userEvent.setup();
    renderPanel([PLAIN_RANGE, PLAIN], vi.fn());

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: /code/ }));
    expect(await screen.findByRole('combobox', { name: 'Match' })).toBeInTheDocument();

    // Switching to the non-range field drops the Match selector and its mode.
    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'owner' }));
    expect(screen.queryByRole('combobox', { name: 'Match' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Value' })).toBeInTheDocument();
  });

  it('clears an applied lookup back to plain list mode', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    renderPanel([PLAIN], onApply);

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'owner' }));
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'acme');
    await user.click(screen.getByRole('button', { name: 'Look up' }));

    await user.click(await screen.findByRole('button', { name: 'Clear lookup' }));
    expect(onApply).toHaveBeenLastCalledWith(null);
  });
});

describe('LookupPanel — sortFrom/sortTo (sort-key window)', () => {
  it('offers the window for an exact match when the endpoint supports it and the sort key is known', async () => {
    const user = userEvent.setup();
    renderPanel([PLAIN], vi.fn(), { supportsSortWindow: true });

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'owner' }));

    expect(await screen.findByRole('textbox', { name: 'Sort from' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Sort to' })).toBeInTheDocument();
  });

  it('never offers the window when the caller has not opted in', async () => {
    const user = userEvent.setup();
    // supportsSortWindow defaults false — Documents' lookup request has no
    // such field at all, so a caller that never opts in must never see it.
    renderPanel([PLAIN], vi.fn());

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'owner' }));

    expect(screen.queryByRole('textbox', { name: 'Sort from' })).not.toBeInTheDocument();
  });

  it("never offers the window when the sort key's units are unknown (a custom sortBy field)", async () => {
    const user = userEvent.setup();
    renderPanel([PLAIN_CUSTOM_SORT], vi.fn(), { supportsSortWindow: true });

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'owner' }));

    // A bound in `priority`'s own value space isn't interpretable by this
    // panel — refused rather than rendering an uninterpretable text pair.
    expect(screen.queryByRole('textbox', { name: 'Sort from' })).not.toBeInTheDocument();
  });

  it('never offers the window for range or prefix mode, only exact', async () => {
    const user = userEvent.setup();
    renderPanel([PLAIN_RANGE], vi.fn(), { supportsSortWindow: true });

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: /code/ }));
    // Default mode is exact — window present.
    expect(await screen.findByRole('textbox', { name: 'Sort from' })).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Match' }));
    await user.click(await screen.findByRole('option', { name: 'Range' }));
    expect(screen.queryByRole('textbox', { name: 'Sort from' })).not.toBeInTheDocument();
  });

  it('offers the window for a composite only once every leg is filled (full-tuple sort continuity)', async () => {
    const user = userEvent.setup();
    renderPanel([COMPOSITE], vi.fn(), { supportsSortWindow: true });

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'status,area' }));
    expect(screen.queryByRole('textbox', { name: 'Sort from' })).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'status' }), 'open');
    expect(screen.queryByRole('textbox', { name: 'Sort from' })).not.toBeInTheDocument(); // still partial

    await user.type(screen.getByRole('textbox', { name: 'area' }), 'billing');
    expect(await screen.findByRole('textbox', { name: 'Sort from' })).toBeInTheDocument();
  });

  it('submits only the bound(s) actually given — never an empty sortTo', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    renderPanel([PLAIN], onApply, { supportsSortWindow: true });

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'owner' }));
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'acme');
    await user.type(screen.getByRole('textbox', { name: 'Sort from' }), '1700000000000');
    await user.click(screen.getByRole('button', { name: 'Look up' }));

    expect(onApply).toHaveBeenCalledWith({
      field: 'owner',
      order: 'asc',
      mode: 'exact',
      value: 'acme',
      sortFrom: '1700000000000',
    });
    // Not sortTo: '' — the key must be absent entirely, not empty.
    const applied = onApply.mock.calls[0]![0] as Record<string, unknown>;
    expect('sortTo' in applied).toBe(false);
  });
});
