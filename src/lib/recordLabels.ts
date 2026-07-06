// ---------------------------------------------------------------------------
// Humanized labels for record status enums — shared by the records list +
// detail so the mapping lives in one place. Unknown values fall back to the
// raw API token (forward-compatible if the backend adds a status).
// ---------------------------------------------------------------------------

import type { IntlShape } from 'react-intl';

/** Index-status tokens we have friendly labels for (RecordResponse.indexStatus). */
const KNOWN_INDEX_STATUSES = new Set(['INDEXED', 'PENDING_INDEX', 'SKIPPED', 'FAILED']);

/**
 * Friendly label for a record's index status, or `null` when absent. A known
 * token resolves to its i18n label (`records.index.<TOKEN>`); an unknown one
 * falls back to the raw token rather than rendering a missing-translation id.
 */
export function indexStatusLabel(intl: IntlShape, status: string | undefined): string | null {
  if (!status) return null;
  return KNOWN_INDEX_STATUSES.has(status)
    ? intl.formatMessage({ id: `records.index.${status}` })
    : status;
}

/** MUI Chip color for a record's index status (mirrors documentStatusColor). */
export function indexStatusColor(
  status: string | undefined,
): 'success' | 'warning' | 'error' | 'default' {
  switch (status) {
    case 'INDEXED':
      return 'success';
    case 'PENDING_INDEX':
      return 'warning';
    case 'FAILED':
      return 'error';
    case 'SKIPPED':
      // Nothing to index (no searchable text) — benign, not an error. Neutral chip.
      return 'default';
    default:
      return 'default';
  }
}

/** Lifecycle tokens we have friendly labels for. `status` is freeform on the
 *  API; ARCHIVED is the well-known soft-retract state (the archive/restore
 *  actions set it), other custom workflow states fall back to the raw token. */
const KNOWN_RECORD_STATUSES = new Set(['ACTIVE', 'ARCHIVED']);

/**
 * Friendly label for a record's lifecycle status; unknown (custom workflow)
 * tokens fall back to the raw token. Returns an em-dash when absent.
 */
export function recordStatusLabel(intl: IntlShape, status: string | undefined): string {
  if (!status) return '—';
  return KNOWN_RECORD_STATUSES.has(status)
    ? intl.formatMessage({ id: `records.status.${status}` })
    : status;
}
