// ---------------------------------------------------------------------------
// RefreshButton — a small manual-refresh control for the load-bearing lists
// (records, documents). These views show server state that changes out-of-band
// — most visibly a document's index status (PENDING_INDEX → INDEXED) — so the
// user needs a way to re-fetch without leaving the page. Shows a spinner and
// disables while a fetch is in flight.
// ---------------------------------------------------------------------------

import { CircularProgress, IconButton, Tooltip } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

interface RefreshButtonProps {
  readonly onClick: () => void;
  /** True while a fetch is in flight — shows a spinner and disables the button. */
  readonly loading: boolean;
  /** Accessible label + tooltip (e.g. "Refresh records"). */
  readonly label: string;
}

export function RefreshButton({ onClick, loading, label }: RefreshButtonProps): React.JSX.Element {
  return (
    <Tooltip title={label}>
      {/* span wrapper so the tooltip still shows while the button is disabled */}
      <span>
        <IconButton onClick={onClick} disabled={loading} aria-label={label} size="small">
          {loading ? <CircularProgress size={20} color="inherit" /> : <RefreshIcon />}
        </IconButton>
      </span>
    </Tooltip>
  );
}
