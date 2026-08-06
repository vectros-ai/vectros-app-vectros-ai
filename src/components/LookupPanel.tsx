// ---------------------------------------------------------------------------
// LookupPanel — the server-side lookup controls shared by the records and
// documents explorers.
//
// Pick a lookup field, a match mode (exact always; range from/to + prefix on
// range-enabled fields), and a sort direction, then Apply. A composite field
// (declared over more than one field, no single `fieldName`) instead offers
// one value input per declared field, in declaration order, and submits an
// exact match under `values[]` — a composite is always equality-only, never
// range/prefix-eligible (the server refuses that pairing at declare time).
//
// The panel owns the in-progress input state; the page owns the APPLIED
// lookup (the thing its query keys on), delivered via `onApply` only on
// submit so the query refetches only when the user runs the lookup. Clear
// resets both. Remount the panel (via `key`) when the type changes — field
// defs differ per type.
//
// i18n: each host page carries its own `<prefix>.lookup*` message family
// (`records.*` / `documents.*`) so copy can diverge per surface if needed.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { FormattedMessage, useIntl } from 'react-intl';

import { lookupFieldLabel } from '../lib/lookupFieldLabel';

/** A server-side lookup mode. Range/prefix are only offered on range-enabled fields. */
export type LookupMode = 'exact' | 'range' | 'prefix';
/** Sort direction for the server lookup (`order`). */
export type LookupOrder = 'asc' | 'desc';
/**
 * An applied (submitted) lookup — drives the page's lookup query.
 * Discriminated on `mode` so each variant carries exactly its bound(s).
 * `multi` is a composite's exact match: one value per declared field, in
 * declaration order — the API's `values[]`, mutually exclusive with `value`.
 *
 * `sortFrom`/`sortTo` narrow `exact`/`multi` further, bounding the lookup
 * field's SORT key (not the matched value) — valid only there ("use with
 * `value`" per the API), and only offered where the sort key's units are
 * known (see `sortUnitsKnown` below). Absent unless the panel's caller opts
 * in (`supportsSortWindow`) — Documents' lookup request has no such field.
 */
export type AppliedLookup = { readonly field: string; readonly order: LookupOrder } & (
  | { readonly mode: 'exact'; readonly value: string; readonly sortFrom?: string; readonly sortTo?: string }
  | {
      readonly mode: 'multi';
      readonly values: readonly string[];
      readonly sortFrom?: string;
      readonly sortTo?: string;
    }
  | { readonly mode: 'range'; readonly from: string; readonly to: string }
  | { readonly mode: 'prefix'; readonly prefix: string }
);

/** Only include a key at all when its value is non-empty (never `key: undefined`). */
function sortBoundArgs(applied: {
  readonly sortFrom?: string;
  readonly sortTo?: string;
}): { sortFrom?: string; sortTo?: string } {
  const out: { sortFrom?: string; sortTo?: string } = {};
  if (applied.sortFrom) out.sortFrom = applied.sortFrom;
  if (applied.sortTo) out.sortTo = applied.sortTo;
  return out;
}

/**
 * The `{ field, ...bound }` args `lookupRecordsByBody` takes beyond
 * `type`/`order`/`limit` — the one place that maps an `AppliedLookup` onto
 * that SDK call's wire shape. (Documents has no `values` field on its lookup
 * request at all — composites are record-only — so it maps its own subset
 * rather than reusing this; see `DocumentsPage.tsx`'s `documentLookupModeArgs`.)
 * Returns a fresh mutable array for `values`: `AppliedLookup` holds it
 * `readonly`, but the generated SDK's `values?: string[]` wants mutable.
 */
export function appliedLookupModeArgs(
  applied: AppliedLookup,
):
  | { value: string; sortFrom?: string; sortTo?: string }
  | { values: string[]; sortFrom?: string; sortTo?: string }
  | { from: string; to: string }
  | { prefix: string } {
  switch (applied.mode) {
    case 'exact':
      return { value: applied.value, ...sortBoundArgs(applied) };
    case 'multi':
      return { values: [...applied.values], ...sortBoundArgs(applied) };
    case 'range':
      return { from: applied.from, to: applied.to };
    case 'prefix':
      return { prefix: applied.prefix };
  }
}

/**
 * Whether `sortFrom`/`sortTo` are interpretable for a lookup sorted by
 * `sortBy` — `undefined` defaults to `createdAt` server-side, and `createdAt`
 * / `lastUpdated` are the only sort keys whose bound format (epoch
 * milliseconds) is documented. A lookup sorted by a declared schema field has
 * a bound in that field's own (unknown-to-this-panel) value space, so the
 * window is hidden there rather than rendering an uninterpretable text pair —
 * the same refuse-rather-than-approximate call as the partial-tuple one above.
 */
function sortUnitsKnown(sortBy: string | undefined): boolean {
  return sortBy === undefined || sortBy === 'createdAt' || sortBy === 'lastUpdated';
}

/**
 * A lookup-able field offered by the panel (schema lookup field or
 * `externalId`). `fieldName` is absent on a composite (one declared over more
 * than one field) — it carries `fieldNames` (its ordered legs) instead.
 *
 * Callers pass every declared lookup through unfiltered; this panel decides
 * what's selectable and how (plain field vs. composite) in exactly one
 * place — see `toSelectableDef` below — so that decision can't drift between
 * callers.
 */
export interface LookupFieldDef {
  readonly fieldName?: string | undefined;
  readonly fieldNames?: readonly string[] | undefined;
  readonly rangeEnabled: boolean;
  /** The exact-match sort key (`createdAt` default, `lastUpdated`, or a declared field). */
  readonly sortBy?: string | undefined;
}

/** A def resolved to what the panel actually renders/submits for it. */
type SelectableDef =
  | {
      readonly kind: 'plain';
      readonly fieldName: string;
      readonly rangeEnabled: boolean;
      readonly sortBy: string | undefined;
    }
  | {
      readonly kind: 'composite';
      readonly identity: string;
      readonly legs: readonly string[];
      readonly sortBy: string | undefined;
    };

/**
 * Resolve one `LookupFieldDef` to what the panel offers: a plain field, or a
 * composite (rendered/keyed by its joined identity, e.g. `status,area` — see
 * {@link lookupFieldLabel}). `null` only for a shape the API never produces
 * (neither `fieldName` nor `fieldNames` set) — excluded defensively.
 */
function toSelectableDef(l: LookupFieldDef): SelectableDef | null {
  if (typeof l.fieldName === 'string') {
    return { kind: 'plain', fieldName: l.fieldName, rangeEnabled: l.rangeEnabled === true, sortBy: l.sortBy };
  }
  if (l.fieldNames && l.fieldNames.length > 0) {
    return { kind: 'composite', identity: lookupFieldLabel(l), legs: l.fieldNames, sortBy: l.sortBy };
  }
  return null;
}

interface LookupPanelProps {
  /** The fields the active type can be looked up by (panel hidden when empty). */
  readonly defs: ReadonlyArray<LookupFieldDef>;
  /** The currently applied lookup (null = plain list mode). */
  readonly applied: AppliedLookup | null;
  /** Called with the submitted lookup on Apply, and with null on Clear. */
  readonly onApply: (lookup: AppliedLookup | null) => void;
  /** i18n message-id prefix: `<prefix>.lookupFieldLabel` etc. */
  readonly messagePrefix: 'records' | 'documents';
  /** DOM id prefix for the labelled selects (unique per page). */
  readonly idPrefix: string;
  /**
   * Whether the host's lookup endpoint accepts `sortFrom`/`sortTo` at all —
   * records does; documents doesn't (`DocumentLookupRequest` has no such
   * field). Defaults to false so a caller must opt in deliberately.
   */
  readonly supportsSortWindow?: boolean;
}

export function LookupPanel({
  defs,
  applied,
  onApply,
  messagePrefix,
  idPrefix,
  supportsSortWindow = false,
}: LookupPanelProps): React.JSX.Element | null {
  const intl = useIntl();
  // In-progress (not yet applied) lookup inputs. `lookupField === ''` ⇒ none.
  const [lookupField, setLookupField] = useState('');
  const [lookupMode, setLookupMode] = useState<LookupMode>('exact');
  const [lookupValue, setLookupValue] = useState('');
  // A composite's per-leg values, in the same order as its `legs` — index i
  // is leg i's value. Kept as one array (not one useState per leg) since the
  // leg count varies per composite and the panel remounts (via `key`) on
  // type change anyway.
  const [compositeValues, setCompositeValues] = useState<readonly string[]>([]);
  const [lookupFrom, setLookupFrom] = useState('');
  const [lookupTo, setLookupTo] = useState('');
  const [lookupPrefix, setLookupPrefix] = useState('');
  const [lookupOrder, setLookupOrder] = useState<LookupOrder>('asc');
  // Sort-key window — valid only alongside an exact/composite match (never
  // range/prefix), and never required: either bound may be given alone, or
  // neither, in which case no window is sent at all.
  const [sortFrom, setSortFrom] = useState('');
  const [sortTo, setSortTo] = useState('');

  const selectableDefs = defs
    .map(toSelectableDef)
    .filter((d): d is SelectableDef => d !== null);

  if (selectableDefs.length === 0) return null;

  const selectedDef = selectableDefs.find(
    (d) => (d.kind === 'plain' ? d.fieldName : d.identity) === lookupField,
  );
  const isComposite = selectedDef?.kind === 'composite';
  // A composite's own leg values, padded to its leg count (unfilled legs read
  // as ''). Derived rather than stored pre-sized, so switching fields never
  // needs an effect to resize the array.
  const compositeLegValues: readonly string[] = isComposite
    ? selectedDef.legs.map((_, i) => compositeValues[i] ?? '')
    : [];
  // Sort continuity requires the FULL tuple (per the API's own contract) —
  // explicit, not incidental, so this stays correct if a leading-run partial
  // tuple is ever offered: while any leg is still unfilled, no sort window.
  const compositeIsFullTuple = isComposite && compositeLegValues.every((v) => v.trim() !== '');
  const rangeAvailable = selectedDef?.kind === 'plain' && selectedDef.rangeEnabled === true;
  // A non-range field can only do exact match, whatever the mode toggle last held.
  const effectiveMode: LookupMode = rangeAvailable ? lookupMode : 'exact';
  // sortFrom/sortTo are valid only alongside a (fully-specified) exact match,
  // only when the endpoint accepts them at all, and only when the sort key's
  // units are interpretable by this panel.
  const showSortWindow =
    supportsSortWindow &&
    (isComposite ? compositeIsFullTuple : effectiveMode === 'exact') &&
    selectedDef !== undefined &&
    sortUnitsKnown(selectedDef.sortBy);
  const lookupReady =
    lookupField !== '' &&
    (isComposite
      ? // Deliberately requires every leg — the API also accepts a leading-run
        // PARTIAL tuple (grouped-by-the-rest results), but exposing that
        // correctly needs its own UI treatment (explaining the grouping) and
        // is left for a follow-up rather than guessed at here.
        compositeLegValues.every((v) => v.trim() !== '')
      : (effectiveMode === 'exact' && lookupValue.trim() !== '') ||
        (effectiveMode === 'range' && lookupFrom.trim() !== '' && lookupTo.trim() !== '') ||
        (effectiveMode === 'prefix' && lookupPrefix.trim() !== ''));

  const msg = (suffix: string): string =>
    intl.formatMessage({ id: `${messagePrefix}.${suffix}` });

  /** Reset every lookup input + the applied lookup back to plain list mode. */
  const resetLookup = (): void => {
    setLookupField('');
    setLookupMode('exact');
    setLookupValue('');
    setCompositeValues([]);
    setLookupFrom('');
    setLookupTo('');
    setLookupPrefix('');
    setLookupOrder('asc');
    setSortFrom('');
    setSortTo('');
    onApply(null);
  };

  /** Submit the configured lookup (or clear it when no field is selected). */
  const applyLookup = (): void => {
    if (lookupField === '') {
      onApply(null);
      return;
    }
    const base = { field: lookupField, order: lookupOrder };
    // Only included when the window is actually offered — never sent for
    // range/prefix, and never as an explicit empty/undefined key.
    const sortBound: { sortFrom?: string; sortTo?: string } = {};
    if (showSortWindow) {
      if (sortFrom.trim() !== '') sortBound.sortFrom = sortFrom.trim();
      if (sortTo.trim() !== '') sortBound.sortTo = sortTo.trim();
    }
    if (isComposite) {
      onApply({
        ...base,
        mode: 'multi',
        values: compositeLegValues.map((v) => v.trim()),
        ...sortBound,
      });
      return;
    }
    onApply(
      effectiveMode === 'exact'
        ? { ...base, mode: 'exact', value: lookupValue.trim(), ...sortBound }
        : effectiveMode === 'range'
          ? { ...base, mode: 'range', from: lookupFrom.trim(), to: lookupTo.trim() }
          : { ...base, mode: 'prefix', prefix: lookupPrefix.trim() },
    );
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id={`${idPrefix}-field-label`}>
            <FormattedMessage id={`${messagePrefix}.lookupFieldLabel`} />
          </InputLabel>
          <Select
            labelId={`${idPrefix}-field-label`}
            label={msg('lookupFieldLabel')}
            value={lookupField}
            onChange={(e) => {
              // Switching field resets the mode + every in-progress value —
              // a stale value from a differently-shaped field (or leg count)
              // must never leak into the next selection.
              setLookupField(e.target.value);
              setLookupMode('exact');
              setLookupValue('');
              setCompositeValues([]);
              setSortFrom('');
              setSortTo('');
            }}
          >
            <MenuItem value="">
              <em>{msg('lookupNone')}</em>
            </MenuItem>
            {selectableDefs.map((d) => {
              const value = d.kind === 'plain' ? d.fieldName : d.identity;
              return (
                <MenuItem key={value} value={value}>
                  {value}
                  {d.kind === 'plain' && d.rangeEnabled ? ' · range' : ''}
                </MenuItem>
              );
            })}
          </Select>
        </FormControl>

        {lookupField !== '' && (
          <>
            {isComposite ? (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ width: '100%' }}>
                  <FormattedMessage id={`${messagePrefix}.lookupCompositeHint`} />
                </Typography>
                {selectedDef.legs.map((leg, i) => (
                  <TextField
                    key={leg}
                    size="small"
                    label={leg}
                    value={compositeLegValues[i]}
                    onChange={(e) => {
                      const next = [...compositeLegValues];
                      next[i] = e.target.value;
                      setCompositeValues(next);
                    }}
                    sx={{ minWidth: 150 }}
                  />
                ))}
              </>
            ) : (
              <>
                {rangeAvailable && (
                  <FormControl size="small" sx={{ minWidth: 130 }}>
                    <InputLabel id={`${idPrefix}-mode-label`}>
                      <FormattedMessage id={`${messagePrefix}.lookupModeLabel`} />
                    </InputLabel>
                    <Select
                      labelId={`${idPrefix}-mode-label`}
                      label={msg('lookupModeLabel')}
                      value={lookupMode}
                      onChange={(e) => setLookupMode(e.target.value as LookupMode)}
                    >
                      <MenuItem value="exact">
                        <FormattedMessage id={`${messagePrefix}.lookupModeExact`} />
                      </MenuItem>
                      <MenuItem value="range">
                        <FormattedMessage id={`${messagePrefix}.lookupModeRange`} />
                      </MenuItem>
                      <MenuItem value="prefix">
                        <FormattedMessage id={`${messagePrefix}.lookupModePrefix`} />
                      </MenuItem>
                    </Select>
                  </FormControl>
                )}

                {effectiveMode === 'exact' && (
                  <TextField
                    size="small"
                    label={msg('lookupValueLabel')}
                    value={lookupValue}
                    onChange={(e) => setLookupValue(e.target.value)}
                    sx={{ minWidth: 200 }}
                  />
                )}
                {effectiveMode === 'range' && (
                  <>
                    <TextField
                      size="small"
                      label={msg('lookupFromLabel')}
                      value={lookupFrom}
                      onChange={(e) => setLookupFrom(e.target.value)}
                      sx={{ minWidth: 150 }}
                    />
                    <TextField
                      size="small"
                      label={msg('lookupToLabel')}
                      value={lookupTo}
                      onChange={(e) => setLookupTo(e.target.value)}
                      sx={{ minWidth: 150 }}
                    />
                  </>
                )}
                {effectiveMode === 'prefix' && (
                  <TextField
                    size="small"
                    label={msg('lookupPrefixLabel')}
                    value={lookupPrefix}
                    onChange={(e) => setLookupPrefix(e.target.value)}
                    sx={{ minWidth: 200 }}
                  />
                )}
              </>
            )}

            {showSortWindow && (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ width: '100%' }}>
                  <FormattedMessage id={`${messagePrefix}.lookupSortWindowHint`} />
                </Typography>
                <TextField
                  size="small"
                  label={msg('lookupSortFromLabel')}
                  value={sortFrom}
                  onChange={(e) => setSortFrom(e.target.value)}
                  sx={{ minWidth: 150 }}
                />
                <TextField
                  size="small"
                  label={msg('lookupSortToLabel')}
                  value={sortTo}
                  onChange={(e) => setSortTo(e.target.value)}
                  sx={{ minWidth: 150 }}
                />
              </>
            )}

            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel id={`${idPrefix}-order-label`}>
                <FormattedMessage id={`${messagePrefix}.lookupOrderLabel`} />
              </InputLabel>
              <Select
                labelId={`${idPrefix}-order-label`}
                label={msg('lookupOrderLabel')}
                value={lookupOrder}
                onChange={(e) => setLookupOrder(e.target.value as LookupOrder)}
              >
                <MenuItem value="asc">
                  <FormattedMessage id={`${messagePrefix}.lookupOrderAsc`} />
                </MenuItem>
                <MenuItem value="desc">
                  <FormattedMessage id={`${messagePrefix}.lookupOrderDesc`} />
                </MenuItem>
              </Select>
            </FormControl>

            <Button variant="contained" onClick={applyLookup} disabled={!lookupReady}>
              <FormattedMessage id={`${messagePrefix}.lookupApply`} />
            </Button>
          </>
        )}

        {applied && (
          <Button onClick={resetLookup}>
            <FormattedMessage id={`${messagePrefix}.lookupClear`} />
          </Button>
        )}
      </Box>
    </Paper>
  );
}
