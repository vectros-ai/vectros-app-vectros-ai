// ---------------------------------------------------------------------------
// VersionHistory — read-only audit-trail timeline for a record or document.
//
// Renders the rows from `getRecordVersions` / `getDocumentVersions` (the
// `{ data, nextCursor }` page's `data`), newest first: the change type, when it
// happened, who made it (and, for a change an agent run made on that person's
// behalf, which agent and run), an optional reason, and the field-level diff
// summary.
//
// This is the no-code expression of Vectros's audit/compliance posture — every
// bootstrapped blueprint with `auditHistory` (the default) gets this view for
// free. Sensitive (PHI/PII) fields are redacted server-side AT WRITE TIME, so
// they never appear here in plaintext regardless of the viewer's scope.
// ---------------------------------------------------------------------------

import { Box, Chip, Stack, Typography } from '@mui/material';
import type { ChipProps } from '@mui/material';
import { FormattedDate, FormattedMessage, useIntl } from 'react-intl';

import type { ActingVia, VersionEntry } from '../api/vectrosApi';

const mono = { fontFamily: 'monospace' } as const;

/** "via agent A · run R" for an agent run; any other (newer) kind is still shown, by its own name. */
function ActingViaLabel({ via }: { via: ActingVia }): React.JSX.Element | null {
  if (!via.kind) return null;
  if (via.kind === 'agent-run') {
    return (
      <FormattedMessage
        id="history.viaAgentRun"
        values={{
          agent: <Box component="span" sx={mono}>{via.actorId ?? ''}</Box>,
          run: <Box component="span" sx={mono}>{via.runId ?? ''}</Box>,
        }}
      />
    );
  }
  return (
    <FormattedMessage
      id="history.viaOther"
      values={{ kind: via.kind, actor: <Box component="span" sx={mono}>{[via.actorId, via.runId].filter(Boolean).join(' / ')}</Box> }}
    />
  );
}

/** Color the change-type chip by its semantics (create=add, update=change, delete=remove). */
function changeTypeColor(changeType: string | undefined): ChipProps['color'] {
  switch (changeType) {
    case 'CREATE':
      return 'success';
    case 'DELETE':
      return 'error';
    case 'UPDATE':
    default:
      return 'info';
  }
}

/** Sort newest-first by `createdAt` (ISO-8601), tie-broken by the monotonic
 *  `previousVersion` so same-timestamp rows (rapid edits) stay deterministically
 *  ordered. Rows without a timestamp sink to the end — defensive; the API sets it. */
function newestFirst(versions: readonly VersionEntry[]): VersionEntry[] {
  return [...versions].sort((a, b) => {
    const byTime = (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    return byTime !== 0 ? byTime : (b.previousVersion ?? 0) - (a.previousVersion ?? 0);
  });
}

export function VersionHistory({
  versions,
  hasMore = false,
}: {
  versions: readonly VersionEntry[];
  /** True when the API reported more (older) pages than this view fetched — so a
   *  long audit trail never silently looks complete. */
  hasMore?: boolean;
}): React.JSX.Element {
  const intl = useIntl();

  if (versions.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        <FormattedMessage id="history.empty" />
      </Typography>
    );
  }

  return (
    <>
      <Stack spacing={0} divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
        {newestFirst(versions).map((v, i) => {
          const changeType = v.changeType ?? 'UPDATE';
          const changedFieldNames = v.changedFields?.fields;
          return (
            <Box key={v.id ?? `${v.createdAt ?? ''}-${i}`} sx={{ py: 1.5 }}>
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ flexWrap: 'wrap', rowGap: 0.5 }}
              >
                <Chip
                  size="small"
                  color={changeTypeColor(changeType)}
                  variant="outlined"
                  label={intl.formatMessage({ id: `history.changeType.${changeType}` })}
                />
                {v.createdAt && (
                  <Typography variant="body2" color="text.secondary">
                    <FormattedDate
                      value={v.createdAt}
                      year="numeric"
                      month="short"
                      day="numeric"
                      hour="2-digit"
                      minute="2-digit"
                    />
                  </Typography>
                )}
                {v.changedBy && (
                  <Typography variant="body2" color="text.secondary">
                    <FormattedMessage
                      id="history.by"
                      values={{
                        who: (
                          <Box component="span" sx={{ fontFamily: 'monospace' }}>
                            {v.changedBy}
                          </Box>
                        ),
                      }}
                    />
                  </Typography>
                )}
                {v.actingVia?.kind && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    data-testid="history-acting-via"
                    title={v.actingVia.tool}
                  >
                    <ActingViaLabel via={v.actingVia} />
                  </Typography>
                )}
                {typeof v.previousVersion === 'number' && (
                  <Typography variant="caption" color="text.secondary">
                    <FormattedMessage
                      id="history.fromVersion"
                      values={{ version: v.previousVersion }}
                    />
                  </Typography>
                )}
              </Stack>

              {changedFieldNames && changedFieldNames.length > 0 && (
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  <FormattedMessage
                    id="history.changedFields"
                    values={{ fields: changedFieldNames.join(', ') }}
                  />
                </Typography>
              )}
              {v.changeReason && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.25, fontStyle: 'italic' }}
                >
                  <FormattedMessage id="history.reason" values={{ reason: v.changeReason }} />
                </Typography>
              )}
            </Box>
          );
        })}
      </Stack>
      {hasMore && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          <FormattedMessage id="history.more" />
        </Typography>
      )}
    </>
  );
}
