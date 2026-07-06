// ---------------------------------------------------------------------------
// LookupPanel — the server-side lookup controls shared by the records and
// documents explorers.
//
// Pick a lookup field, a match mode (exact always; range from/to + prefix on
// range-enabled fields), and a sort direction, then Apply. The panel owns the
// in-progress input state; the page owns the APPLIED lookup (the thing its
// query keys on), delivered via `onApply` only on submit so the query refetches
// only when the user runs the lookup. Clear resets both. Remount the panel
// (via `key`) when the type changes — field defs differ per type.
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
} from '@mui/material';
import { FormattedMessage, useIntl } from 'react-intl';

/** A server-side lookup mode. Range/prefix are only offered on range-enabled fields. */
export type LookupMode = 'exact' | 'range' | 'prefix';
/** Sort direction for the server lookup (`order`). */
export type LookupOrder = 'asc' | 'desc';
/**
 * An applied (submitted) lookup — drives the page's lookup query.
 * Discriminated on `mode` so each variant carries exactly its bound(s).
 */
export type AppliedLookup = { readonly field: string; readonly order: LookupOrder } & (
  | { readonly mode: 'exact'; readonly value: string }
  | { readonly mode: 'range'; readonly from: string; readonly to: string }
  | { readonly mode: 'prefix'; readonly prefix: string }
);

/** A lookup-able field offered by the panel (schema lookup field or `externalId`). */
export interface LookupFieldDef {
  readonly fieldName: string;
  readonly rangeEnabled: boolean;
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
}

export function LookupPanel({
  defs,
  applied,
  onApply,
  messagePrefix,
  idPrefix,
}: LookupPanelProps): React.JSX.Element | null {
  const intl = useIntl();
  // In-progress (not yet applied) lookup inputs. `lookupField === ''` ⇒ none.
  const [lookupField, setLookupField] = useState('');
  const [lookupMode, setLookupMode] = useState<LookupMode>('exact');
  const [lookupValue, setLookupValue] = useState('');
  const [lookupFrom, setLookupFrom] = useState('');
  const [lookupTo, setLookupTo] = useState('');
  const [lookupPrefix, setLookupPrefix] = useState('');
  const [lookupOrder, setLookupOrder] = useState<LookupOrder>('asc');

  if (defs.length === 0) return null;

  const selectedDef = defs.find((l) => l.fieldName === lookupField);
  const rangeAvailable = selectedDef?.rangeEnabled === true;
  // A non-range field can only do exact match, whatever the mode toggle last held.
  const effectiveMode: LookupMode = rangeAvailable ? lookupMode : 'exact';
  const lookupReady =
    lookupField !== '' &&
    ((effectiveMode === 'exact' && lookupValue.trim() !== '') ||
      (effectiveMode === 'range' && lookupFrom.trim() !== '' && lookupTo.trim() !== '') ||
      (effectiveMode === 'prefix' && lookupPrefix.trim() !== ''));

  const msg = (suffix: string): string =>
    intl.formatMessage({ id: `${messagePrefix}.${suffix}` });

  /** Reset every lookup input + the applied lookup back to plain list mode. */
  const resetLookup = (): void => {
    setLookupField('');
    setLookupMode('exact');
    setLookupValue('');
    setLookupFrom('');
    setLookupTo('');
    setLookupPrefix('');
    setLookupOrder('asc');
    onApply(null);
  };

  /** Submit the configured lookup (or clear it when no field is selected). */
  const applyLookup = (): void => {
    if (lookupField === '') {
      onApply(null);
      return;
    }
    const base = { field: lookupField, order: lookupOrder };
    onApply(
      effectiveMode === 'exact'
        ? { ...base, mode: 'exact', value: lookupValue.trim() }
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
              // Switching field resets the mode (range may no longer apply).
              setLookupField(e.target.value);
              setLookupMode('exact');
            }}
          >
            <MenuItem value="">
              <em>{msg('lookupNone')}</em>
            </MenuItem>
            {defs.map((l) => (
              <MenuItem key={l.fieldName} value={l.fieldName}>
                {l.fieldName}
                {l.rangeEnabled ? ' · range' : ''}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {lookupField !== '' && (
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
