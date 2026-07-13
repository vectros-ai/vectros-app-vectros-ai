// ---------------------------------------------------------------------------
// Humanized labels + chip colors for document statuses — shared by the
// documents list + detail. Documents carry TWO status axes (mirroring records):
//   - lifecycle `status` (caller-controlled): ACTIVE | ARCHIVED — archived
//     documents are soft-retracted (pulled from search, kept + recoverable).
//   - processing `indexStatus` (system-managed, read-only): the extraction /
//     indexing pipeline state.
// Unknown values fall back to the raw API token (forward-compatible if the
// backend adds a status).
// ---------------------------------------------------------------------------

import type { IntlShape } from 'react-intl';

/** Lifecycle tokens we have friendly labels for (DocumentResponse.status). */
const KNOWN_STATUSES = new Set(['ACTIVE', 'ARCHIVED']);

/** Index-status tokens we have friendly labels for (DocumentResponse.indexStatus). */
const KNOWN_INDEX_STATUSES = new Set([
  'PENDING_UPLOAD',
  'UPLOADED',
  'EXTRACTING',
  'PENDING_INDEX',
  'INDEXED',
  'SKIPPED',
  'STORED',
  'FAILED',
]);

/**
 * Friendly label for a document's lifecycle status, or an em-dash when absent.
 * A known token resolves to its i18n label (`documents.status.<TOKEN>`); an
 * unknown one falls back to the raw token rather than a missing-translation id.
 */
export function documentStatusLabel(intl: IntlShape, status: string | undefined): string {
  if (!status) return '—';
  return KNOWN_STATUSES.has(status)
    ? intl.formatMessage({ id: `documents.status.${status}` })
    : status;
}

/**
 * Friendly label for a document's processing (index) status, or `null` when
 * absent. A known token resolves to its i18n label (`documents.index.<TOKEN>`);
 * an unknown one falls back to the raw token.
 */
export function documentIndexStatusLabel(
  intl: IntlShape,
  indexStatus: string | undefined,
): string | null {
  if (!indexStatus) return null;
  return KNOWN_INDEX_STATUSES.has(indexStatus)
    ? intl.formatMessage({ id: `documents.index.${indexStatus}` })
    : indexStatus;
}

/** MUI Chip color for a document's processing (index) status (mirrors records). */
export function documentIndexStatusColor(
  indexStatus: string | undefined,
): 'success' | 'warning' | 'error' | 'default' {
  switch (indexStatus) {
    case 'INDEXED':
      return 'success';
    case 'PENDING_UPLOAD':
    case 'UPLOADED':
    case 'EXTRACTING':
    case 'PENDING_INDEX':
      // In-flight pipeline states — not final yet.
      return 'warning';
    case 'FAILED':
      return 'error';
    case 'SKIPPED':
      // Extraction produced no indexable text — benign, not an error. Neutral chip.
      return 'default';
    case 'STORED':
      // Store-only by design (indexMode=NONE) — retrievable, deliberately unindexed.
      return 'default';
    default:
      return 'default';
  }
}
