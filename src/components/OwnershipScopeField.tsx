// ---------------------------------------------------------------------------
// OwnershipScopeField — create-time ownership-scope selector.
//
// A record / document / folder can be created with:
//   - Inherit (default) — omit `scopes`, stamping the token's full identity,
//   - Private           — `scopes: []`, owned by the calling user alone,
//   - Custom            — explicit `namespace:value` scopes (≤2), whose values
//                         must match the token's identity (the API validates).
//
// Fully self-contained: it owns the mode + entry state and reports the resulting
// wire `scopes` value (undefined | [] | [...]) plus a validity flag through
// `onChange`, so the host form can thread it into the create body and gate Save.
// Deliberately distinct from the app's content-type/folder "scope" controls —
// this is OWNERSHIP.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Collapse,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { FormattedMessage, useIntl } from 'react-intl';
import type { IntlShape } from 'react-intl';

import {
  buildScopes,
  validateScopeEntries,
} from '../lib/ownershipScopes';
import type {
  OwnershipMode,
  ScopeEntriesError,
  ScopeEntry,
} from '../lib/ownershipScopes';
import { MAX_SCOPE_NAMESPACES } from '../lib/scopeNamespace';

export interface OwnershipScopeSelection {
  /** Wire value: `undefined` = inherit (omit), `[]` = private, `[..]` = custom. */
  readonly scopes: string[] | undefined;
  /** False while the custom entries are incomplete/invalid — gate Save on this. */
  readonly valid: boolean;
}

interface OwnershipScopeFieldProps {
  readonly onChange: (selection: OwnershipScopeSelection) => void;
  readonly disabled?: boolean;
}

function formatEntriesError(error: ScopeEntriesError, intl: IntlShape): string {
  switch (error.code) {
    case 'tooMany':
      return intl.formatMessage(
        { id: 'ownershipScope.errorTooMany' },
        { max: error.max },
      );
    case 'value':
      return intl.formatMessage({ id: 'ownershipScope.errorValue' });
    case 'duplicate':
      return intl.formatMessage(
        { id: 'ownershipScope.errorDuplicate' },
        { namespace: error.namespace },
      );
    case 'empty':
      return intl.formatMessage({ id: 'ownershipScope.errorEmpty' });
    case 'namespace':
      if (error.error.code === 'reserved') {
        return intl.formatMessage(
          { id: 'ownershipScope.errorReserved' },
          { namespace: error.error.namespace },
        );
      }
      return intl.formatMessage({ id: 'ownershipScope.errorNamespace' });
  }
}

export function OwnershipScopeField({
  onChange,
  disabled = false,
}: OwnershipScopeFieldProps): React.JSX.Element {
  const intl = useIntl();
  const [mode, setMode] = useState<OwnershipMode>('inherit');
  const [entries, setEntries] = useState<ScopeEntry[]>([
    { namespace: '', value: '' },
  ]);

  // Report the selection to the host whenever mode/entries change. Guarded via a
  // ref so an unstable parent `onChange` can't cause a re-render loop.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const err = mode === 'custom' ? validateScopeEntries(entries) : null;
    onChangeRef.current({ scopes: buildScopes(mode, entries), valid: err === null });
  }, [mode, entries]);

  const displayError = mode === 'custom' ? validateScopeEntries(entries) : null;
  const completeCount = entries.filter(
    (e) => e.namespace.trim() !== '' && e.value.trim() !== '',
  ).length;

  const updateEntry = (
    index: number,
    patch: Partial<ScopeEntry>,
  ): void => {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  };
  const addEntry = (): void =>
    setEntries((prev) => [...prev, { namespace: '', value: '' }]);
  const removeEntry = (index: number): void =>
    setEntries((prev) =>
      prev.length === 1 ? prev : prev.filter((_, i) => i !== index),
    );

  return (
    <FormControl component="fieldset" disabled={disabled} sx={{ display: 'block' }}>
      <FormLabel component="legend" sx={{ mb: 0.5 }}>
        <FormattedMessage id="ownershipScope.legend" />
      </FormLabel>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
        <FormattedMessage id="ownershipScope.help" />
      </Typography>
      <RadioGroup
        value={mode}
        onChange={(_e, v) => setMode(v as OwnershipMode)}
      >
        <FormControlLabel
          value="inherit"
          control={<Radio size="small" />}
          label={<FormattedMessage id="ownershipScope.modeInherit" />}
        />
        <FormControlLabel
          value="private"
          control={<Radio size="small" />}
          label={<FormattedMessage id="ownershipScope.modePrivate" />}
        />
        <FormControlLabel
          value="custom"
          control={<Radio size="small" />}
          label={<FormattedMessage id="ownershipScope.modeCustom" />}
        />
      </RadioGroup>

      <Collapse in={mode === 'custom'}>
        <Stack spacing={1} sx={{ mt: 1, pl: 1 }}>
          {entries.map((entry, i) => (
            <Stack
              key={i}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              alignItems="flex-start"
            >
              <TextField
                size="small"
                label={intl.formatMessage({ id: 'ownershipScope.namespaceLabel' })}
                placeholder={intl.formatMessage({
                  id: 'ownershipScope.namespacePlaceholder',
                })}
                value={entry.namespace}
                onChange={(e) => updateEntry(i, { namespace: e.target.value })}
                disabled={disabled}
                slotProps={{ htmlInput: { spellCheck: false } }}
                sx={{ width: { xs: '100%', sm: 180 }, '& input': { fontFamily: 'monospace' } }}
              />
              <TextField
                size="small"
                label={intl.formatMessage({ id: 'ownershipScope.valueLabel' })}
                value={entry.value}
                onChange={(e) => updateEntry(i, { value: e.target.value })}
                disabled={disabled}
                slotProps={{ htmlInput: { spellCheck: false } }}
                sx={{ flex: 1, minWidth: 0, width: '100%', '& input': { fontFamily: 'monospace' } }}
              />
              <Tooltip title={intl.formatMessage({ id: 'ownershipScope.removeScope' })}>
                <span>
                  <IconButton
                    size="small"
                    onClick={() => removeEntry(i)}
                    disabled={disabled || entries.length === 1}
                    aria-label={intl.formatMessage({ id: 'ownershipScope.removeScope' })}
                    sx={{ mt: 0.5 }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          ))}
          <Box>
            <Button
              size="small"
              variant="text"
              startIcon={<AddIcon />}
              onClick={addEntry}
              disabled={disabled || completeCount >= MAX_SCOPE_NAMESPACES}
              sx={{ textTransform: 'none' }}
            >
              <FormattedMessage id="ownershipScope.addScope" />
            </Button>
          </Box>
          {displayError && (
            <Typography variant="caption" color="error.main" role="alert">
              {formatEntriesError(displayError, intl)}
            </Typography>
          )}
        </Stack>
      </Collapse>
    </FormControl>
  );
}
