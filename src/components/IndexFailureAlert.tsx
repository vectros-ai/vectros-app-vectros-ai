// ---------------------------------------------------------------------------
// IndexFailureAlert — the "why did indexing fail?" detail for an item.
//
// A record or document whose `indexStatus` is `FAILED` may carry an
// `indexFailure` reason (`{ code, message }`). Showing it turns a dead-end
// ("Failed", no explanation — a support ticket) into a self-service signal:
// the `message` is backend-supplied and suitable for end users, and the `code`
// tells us how bad it is. Several codes mean the content is still *partly*
// findable (one index leg is serving it), which is a warning, not an outage;
// the rest mean it is not findable at all, or an error on our side.
//
// Branch on `code`, never on `message` — the wording may change between
// releases. When the status is FAILED but no reason is attached (an older item,
// or a failure the backend recorded without detail), fall back to a generic
// "contact support" line rather than showing nothing.
// ---------------------------------------------------------------------------

import { Alert, Typography } from '@mui/material';
import { FormattedMessage } from 'react-intl';

/** The minimal shape both `RecordResponse.indexFailure` and
 *  `DocumentResponse.indexFailure` satisfy — kept structural so this component
 *  serves records and documents without importing either response type. */
export interface IndexFailureLike {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

interface IndexFailureAlertProps {
  /** The item's processing status; the alert renders only when it is `FAILED`. */
  readonly indexStatus: string | undefined;
  /** The failure reason, present on a `FAILED` item that recorded one. */
  readonly indexFailure: IndexFailureLike | undefined;
}

/** Failure codes under which at least one index leg still serves the content,
 *  so it remains partly findable — a warning rather than a hard failure. The
 *  fully-broken codes (`INDEXING_FAILED`, `SOURCE_UNAVAILABLE`) and the
 *  server-side `INTERNAL` fall through to `error`. */
const PARTLY_FINDABLE_CODES: ReadonlySet<string> = new Set([
  'TEXT_INDEX_FAILED',
  'EMBEDDING_FAILED',
  'VECTOR_LIMIT_EXCEEDED',
]);

/**
 * An accessible alert explaining a `FAILED` index status. Renders nothing for
 * any other status. Severity is derived from the failure `code`; the body is
 * the backend `message`, or a generic fallback when no reason is attached.
 */
export function IndexFailureAlert({
  indexStatus,
  indexFailure,
}: IndexFailureAlertProps): React.JSX.Element | null {
  if (indexStatus !== 'FAILED') return null;

  const code = indexFailure?.code;
  const message = indexFailure?.message?.trim();
  const severity = code !== undefined && PARTLY_FINDABLE_CODES.has(code) ? 'warning' : 'error';

  return (
    <Alert severity={severity} role="alert" sx={{ mt: 1 }}>
      <Typography variant="body2">
        {message !== undefined && message !== '' ? (
          message
        ) : (
          <FormattedMessage id="index.failure.noReason" />
        )}
      </Typography>
    </Alert>
  );
}
