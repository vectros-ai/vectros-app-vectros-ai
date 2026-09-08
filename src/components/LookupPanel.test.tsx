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
// A three-leg composite — needed to tell "the very next leg is reachable"
// apart from "every remaining leg is disabled", which a two-leg def can't
// distinguish (there's only one leg left to check either way).
const COMPOSITE3: LookupFieldDef = { fieldNames: ['status', 'area', 'owner'], rangeEnabled: false };
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

  it('disables Look up until the FIRST leg has a value, then allows a partial (leading-run) submission', async () => {
    const user = userEvent.setup();
    renderPanel([COMPOSITE], vi.fn());

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'status,area' }));

    const applyButton = screen.getByRole('button', { name: 'Look up' });
    expect(applyButton).toBeDisabled();

    // One of two legs filled is enough — the API accepts a leading-run
    // PARTIAL tuple, grouped by the leg(s) left blank.
    await user.type(screen.getByRole('textbox', { name: 'status' }), 'open');
    expect(applyButton).toBeEnabled();

    await user.type(screen.getByRole('textbox', { name: 'area' }), 'billing');
    expect(applyButton).toBeEnabled();
  });

  it('disables a leg until its predecessor has a value, and cascade-clears every leg after one just blanked', async () => {
    const user = userEvent.setup();
    renderPanel([COMPOSITE3], vi.fn());

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'status,area,owner' }));

    const status = screen.getByRole('textbox', { name: 'status' });
    const area = screen.getByRole('textbox', { name: 'area' });
    const owner = screen.getByRole('textbox', { name: 'owner' });
    // Only the very first leg is reachable until it has a value.
    expect(status).toBeEnabled();
    expect(area).toBeDisabled();
    expect(owner).toBeDisabled();

    await user.type(status, 'open');
    expect(area).toBeEnabled(); // the next leg in the run becomes reachable
    expect(owner).toBeDisabled(); // still unreachable — area is still blank

    await user.type(area, 'billing');
    expect(owner).toBeEnabled();
    await user.type(owner, 'acme');

    // Blanking the first leg must invalidate (and disable) every leg after
    // it — a filled `area`/`owner` behind a blank `status` would be a gap
    // the API never accepts.
    await user.clear(status);
    expect(area).toHaveValue('');
    expect(area).toBeDisabled();
    expect(owner).toHaveValue('');
    expect(owner).toBeDisabled();
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

  it('submits a PARTIAL tuple as just the leading run — never padded with empty trailing legs', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    renderPanel([COMPOSITE3], onApply);

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'status,area,owner' }));
    await user.type(screen.getByRole('textbox', { name: 'status' }), 'open');
    await user.click(screen.getByRole('button', { name: 'Look up' }));

    expect(onApply).toHaveBeenCalledWith({
      field: 'status,area,owner',
      order: 'asc',
      mode: 'multi',
      values: ['open'], // NOT ['open', '', '']
    });
  });

  it('shows the partial-tuple grouping hint once a leg is filled but the tuple is not yet complete', async () => {
    const user = userEvent.setup();
    renderPanel([COMPOSITE], vi.fn());

    // The static composite hint (always shown) also mentions grouping in the
    // abstract, so match the PARTIAL hint's own distinguishing text (the
    // field list it names) rather than the word "grouped" alone.
    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'status,area' }));
    expect(screen.queryByText(/grouped by: area/i)).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'status' }), 'open');
    expect(await screen.findByText(/grouped by: area/i)).toBeInTheDocument();

    // A fully-specified tuple narrows to an exact match — no grouping, so
    // the hint goes away again.
    await user.type(screen.getByRole('textbox', { name: 'area' }), 'billing');
    expect(screen.queryByText(/grouped by: area/i)).not.toBeInTheDocument();
  });

  it('hides the partial-tuple hint once Applied — the host page already says it about the results on screen — and brings it back (then re-submits) once the legs are edited again', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    renderPanel([COMPOSITE], onApply);

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'status,area' }));
    await user.type(screen.getByRole('textbox', { name: 'status' }), 'open');
    expect(await screen.findByText(/grouped by: area/i)).toBeInTheDocument();

    // Submitting the partial tuple as-is: the panel's own hint would just be
    // repeating what the host page's "grouped by" note (rendered elsewhere,
    // not by this component) already says about the results now on screen.
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(onApply).toHaveBeenNthCalledWith(1, {
      field: 'status,area',
      order: 'asc',
      mode: 'multi',
      values: ['open'],
    });
    expect(screen.queryByText(/grouped by: area/i)).not.toBeInTheDocument();

    // Editing the legs again — composing a NEW, not-yet-submitted lookup —
    // brings the forward guidance back, even though something is still
    // "applied" (the stale, previously-submitted one)...
    await user.type(screen.getByRole('textbox', { name: 'status' }), '2');
    expect(await screen.findByText(/grouped by: area/i)).toBeInTheDocument();

    // ...and re-Apply genuinely re-submits the edited tuple, not a no-op —
    // the panel's input state was never reset by the first Apply.
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(onApply).toHaveBeenNthCalledWith(2, {
      field: 'status,area',
      order: 'asc',
      mode: 'multi',
      values: ['open2'],
    });
    expect(screen.queryByText(/grouped by: area/i)).not.toBeInTheDocument();
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
    // supportsSortWindow defaults false: the opt-in, not the endpoint, is
    // what gates the window, so a caller that never opts in must never see it.
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

  // A RANGE-ENABLED field never offers the window, in ANY mode — not merely in
  // range/prefix mode. Such a field is stored as an ordered row rather than in a
  // fast lookup slot, so it has no sort key to narrow, and the server refuses
  // `sortFrom`/`sortTo` on one outright ("declared rangeEnabled ... so it has no
  // sort key to narrow") on records and documents alike.
  //
  // This cell previously asserted the OPPOSITE for the default mode ("Default
  // mode is exact — window present"), i.e. it pinned the defect: mode defaults
  // to exact, so the window rendered and every submission was a guaranteed 400.
  it('never offers the window for a range-enabled field, in any mode', async () => {
    const user = userEvent.setup();
    renderPanel([PLAIN_RANGE], vi.fn(), { supportsSortWindow: true });

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: /code/ }));
    // Exact is the default mode, and it is the case that used to leak.
    expect(screen.queryByRole('textbox', { name: 'Sort from' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Match' }));
    await user.click(await screen.findByRole('option', { name: 'Range' }));
    expect(screen.queryByRole('textbox', { name: 'Sort from' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Match' }));
    await user.click(await screen.findByRole('option', { name: 'Prefix' }));
    expect(screen.queryByRole('textbox', { name: 'Sort from' })).not.toBeInTheDocument();
  });

  // The control for the cell above: a field that is NOT range-enabled still gets
  // the window in exact mode, so the new term is about `rangeEnabled` and has
  // not simply switched the feature off.
  it('still offers the window for a non-range-enabled field in exact mode', async () => {
    const user = userEvent.setup();
    renderPanel([PLAIN], vi.fn(), { supportsSortWindow: true });

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'owner' }));
    expect(await screen.findByRole('textbox', { name: 'Sort from' })).toBeInTheDocument();
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

  it('clears the sort window when a full composite tuple is edited back to partial — never resubmits a stale bound once refilled', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    renderPanel([COMPOSITE], onApply, { supportsSortWindow: true });

    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'status,area' }));
    await user.type(screen.getByRole('textbox', { name: 'status' }), 'open');
    await user.type(screen.getByRole('textbox', { name: 'area' }), 'billing');
    await user.type(await screen.findByRole('textbox', { name: 'Sort from' }), '1700000000000');

    // Blanking a leg hides the window (full-tuple-only) — clearing the leg
    // must also clear the bound sitting behind it, not just hide it.
    await user.clear(screen.getByRole('textbox', { name: 'area' }));
    expect(screen.queryByRole('textbox', { name: 'Sort from' })).not.toBeInTheDocument();

    // Refilling the tuple back to full brings the window back — EMPTY, not
    // carrying the value typed before the edit.
    await user.type(screen.getByRole('textbox', { name: 'area' }), 'support');
    expect(await screen.findByRole('textbox', { name: 'Sort from' })).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Look up' }));
    const applied = onApply.mock.calls[0]![0] as Record<string, unknown>;
    expect('sortFrom' in applied).toBe(false);
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
