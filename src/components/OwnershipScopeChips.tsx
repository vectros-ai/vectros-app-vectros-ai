// ---------------------------------------------------------------------------
// OwnershipScopeChips — read-only display of an item's `scopes` ownership.
//
//   - undefined  → em dash (ownership is shown by the separate owner field),
//   - []         → "Private" (owned by the calling user alone),
//   - [..]       → one chip per `namespace:value` entry.
// ---------------------------------------------------------------------------

import { Chip, Stack, Typography } from '@mui/material';
import { FormattedMessage } from 'react-intl';

interface OwnershipScopeChipsProps {
  readonly scopes: readonly string[] | undefined;
}

export function OwnershipScopeChips({
  scopes,
}: OwnershipScopeChipsProps): React.JSX.Element {
  if (!scopes) {
    return (
      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
        —
      </Typography>
    );
  }
  if (scopes.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        <FormattedMessage id="ownershipScope.private" />
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {scopes.map((s) => (
        <Chip
          key={s}
          size="small"
          variant="outlined"
          label={s}
          sx={{ fontFamily: 'monospace', maxWidth: 260 }}
        />
      ))}
    </Stack>
  );
}
