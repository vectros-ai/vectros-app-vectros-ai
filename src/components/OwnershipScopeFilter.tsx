// ---------------------------------------------------------------------------
// OwnershipScopeFilter — a single `namespace:value` ownership filter input.
//
// Controlled by the host page: the raw text lives in the page's query state so
// it can feed the `scope=<namespace>:<value>` list/search/RAG parameter and the
// query key. This is the OWNERSHIP filter — deliberately separate from the
// content-type / folder "scope" controls the pages already have.
//
// Use `scopeFilterParam(value)` to derive the wire value: it returns the trimmed
// `namespace:value` only when both halves are well-formed (valid namespace, a
// non-empty whitespace-free value), so a half-typed filter never fires a request
// that the API would just reject.
// ---------------------------------------------------------------------------

import { TextField } from '@mui/material';
import { useIntl } from 'react-intl';

import { validateScopeFilter } from '../lib/ownershipScopes';

/** The `scope` query param for a filter string, or undefined when not usable. */
export function scopeFilterParam(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  return validateScopeFilter(trimmed) === null ? trimmed : undefined;
}

interface OwnershipScopeFilterProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}

export function OwnershipScopeFilter({
  value,
  onChange,
  disabled = false,
}: OwnershipScopeFilterProps): React.JSX.Element {
  const intl = useIntl();
  // Only flag an error once the user has typed something malformed.
  const invalid = value.trim() !== '' && validateScopeFilter(value) !== null;
  return (
    <TextField
      size="small"
      label={intl.formatMessage({ id: 'ownershipScope.filterLabel' })}
      placeholder={intl.formatMessage({ id: 'ownershipScope.filterPlaceholder' })}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      error={invalid}
      helperText={
        invalid
          ? intl.formatMessage({ id: 'ownershipScope.filterInvalid' })
          : intl.formatMessage({ id: 'ownershipScope.filterHelp' })
      }
      slotProps={{ htmlInput: { spellCheck: false } }}
      sx={{ minWidth: 220, '& input': { fontFamily: 'monospace' } }}
    />
  );
}
