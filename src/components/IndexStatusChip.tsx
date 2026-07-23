// ---------------------------------------------------------------------------
// IndexStatusChip — the index-status chip for a list row, with the failure
// reason attached as a tooltip.
//
// The list views show index status as a compact colored chip. When the status
// is FAILED and the item carries an `indexFailure` reason, we surface the
// backend `message` on hover so a caller scanning the list learns *why* without
// opening the row (the detail page shows the same reason as a full alert). The
// label + color are computed by the caller's type-specific helpers and passed
// in, so this serves both records and documents.
// ---------------------------------------------------------------------------

import { Chip, Tooltip } from '@mui/material';

interface IndexStatusChipProps {
  /** Humanized status label (already localized), or `null` when unknown. */
  readonly label: string | null;
  /** MUI Chip color for the status. */
  readonly color: 'success' | 'warning' | 'error' | 'default';
  /** The failure reason message, when the item recorded one. */
  readonly failureMessage: string | undefined;
}

/** A status chip; when a failure `message` is present it is shown on hover. */
export function IndexStatusChip({
  label,
  color,
  failureMessage,
}: IndexStatusChipProps): React.JSX.Element {
  const chip = <Chip size="small" variant="outlined" label={label} color={color} />;
  const message = failureMessage?.trim();
  if (message === undefined || message === '') return chip;
  return <Tooltip title={message}>{chip}</Tooltip>;
}
