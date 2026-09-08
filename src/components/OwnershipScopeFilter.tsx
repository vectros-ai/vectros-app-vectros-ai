// ---------------------------------------------------------------------------
// OwnershipScopeFilter — a `namespace:value` ownership filter input.
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
//
// `allowMultiple` opts into a comma-separated list, for the two surfaces that
// accept more than one ownership dimension — `/v1/search` and `/v1/rag`, via
// their `scopeFilters` array. It is OFF by default because the list endpoints
// (`GET /v1/records`, `/v1/documents`) take only the singular `scope`: offering
// a second dimension there would render a control the backend cannot honor.
// A host that opts in derives its wire value with `scopeFiltersParam` and picks
// the field itself — `scope` for one entry, `scopeFilters` for more (the API
// rejects both together).
// ---------------------------------------------------------------------------

import { TextField } from '@mui/material';
import { useIntl } from 'react-intl';

import { MAX_SCOPE_FILTERS, validateScopeFilter, validateScopeFilters } from '../lib/ownershipScopes';

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
  /** Accept a comma-separated list of dimensions (search / RAG only). */
  readonly allowMultiple?: boolean;
}

export function OwnershipScopeFilter({
  value,
  onChange,
  disabled = false,
  allowMultiple = false,
}: OwnershipScopeFilterProps): React.JSX.Element {
  const intl = useIntl();
  // Only flag an error once the user has typed something malformed. In multi
  // mode each error CODE gets its own message: the three failures (a malformed
  // entry, a namespace named twice, too many dimensions) have different fixes,
  // and collapsing them into one sentence both hid which one applied and forced
  // the cap to be restated as a literal beside `MAX_SCOPE_FILTERS`.
  const multiError = allowMultiple && value.trim() !== '' ? validateScopeFilters(value) : null;
  const invalid =
    value.trim() !== '' &&
    (allowMultiple ? multiError !== null : validateScopeFilter(value) !== null);
  const suffix = allowMultiple ? 'Multi' : '';

  const errorText = ((): string => {
    if (!allowMultiple) return intl.formatMessage({ id: 'ownershipScope.filterInvalid' });
    switch (multiError?.code) {
      case 'duplicate':
        return intl.formatMessage(
          { id: 'ownershipScope.filterInvalidMultiDuplicate' },
          { namespace: multiError.namespace },
        );
      case 'tooMany':
        return intl.formatMessage(
          { id: 'ownershipScope.filterInvalidMultiTooMany' },
          { max: multiError.max },
        );
      default:
        return intl.formatMessage(
          { id: 'ownershipScope.filterInvalidMultiEntry' },
          { entry: multiError?.code === 'entry' ? multiError.raw : '' },
        );
    }
  })();
  return (
    <TextField
      size="small"
      label={intl.formatMessage({ id: 'ownershipScope.filterLabel' })}
      placeholder={intl.formatMessage({ id: `ownershipScope.filterPlaceholder${suffix}` })}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      error={invalid}
      helperText={
        invalid
          ? errorText
          : intl.formatMessage(
              { id: `ownershipScope.filterHelp${suffix}` },
              { max: MAX_SCOPE_FILTERS },
            )
      }
      slotProps={{ htmlInput: { spellCheck: false } }}
      sx={{ minWidth: allowMultiple ? 280 : 220, '& input': { fontFamily: 'monospace' } }}
    />
  );
}
