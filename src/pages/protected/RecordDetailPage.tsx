// ---------------------------------------------------------------------------
// RecordDetailPage — read-only record view (path: `/records/:recordId`).
//
// Shows the record's metadata (type, schema, status, ownership, version,
// timestamps), its full payload as formatted JSON — the "raw view" that is
// always available — and its audit-trail version history. Writes: edit (the
// editor page), delete (confirm-gated), and archive/restore (the record
// lifecycle `status` — archiving soft-retracts the record from search while
// keeping it retrievable, the same model as documents).
//
// Renders inside RequireContext, so the active context is resolved.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import { Alert, Box, Button, Card, CardContent, Chip, Link, Stack, Typography } from '@mui/material';
import ArchiveOutlined from '@mui/icons-material/ArchiveOutlined';
import ArrowBack from '@mui/icons-material/ArrowBack';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import EditOutlined from '@mui/icons-material/EditOutlined';
import UnarchiveOutlined from '@mui/icons-material/UnarchiveOutlined';
import { FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { ConfirmDialog, LoadingBlock, MetaList, MetaRow } from '@vectros-ai/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveContextId, useActiveTenantId } from '../../auth';
import { vectrosApiClient } from '../../api/vectrosApi';
import type { SchemaResponse, Vectros } from '../../api/vectrosApi';
import { listAllSchemas } from '../../lib/listAllSchemas';
import { dataQueryKeys } from '../../lib/dataQueryKeys';
import { indexStatusLabel, recordStatusLabel } from '../../lib/recordLabels';
import { findDisplayFieldId, formatCellValue } from '../../lib/recordColumns';
import { deriveReferenceFields, referenceValues } from '../../lib/recordReferences';
import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { ReferenceLink } from '../../components/ReferenceLink';
import { OwnershipScopeChips } from '../../components/OwnershipScopeChips';
import { RequestIdCaption } from '../../components/RequestIdCaption';
import { VersionHistory } from '../../components/VersionHistory';

export function RecordDetailPage(): React.JSX.Element {
  const tenant = useActiveTenantId();
  const context = useActiveContextId();
  const intl = useIntl();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { recordId = '' } = useParams();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);

  const recordQuery = useQuery({
    queryKey: dataQueryKeys.record(tenant, context, recordId),
    queryFn: () => vectrosApiClient(tenant, context).records.getRecord({ id: recordId }),
    enabled: recordId !== '',
  });

  // The record's schema drives the displayField title + reference cross-links.
  // Cheap + cached (shared with RecordsPage); the view degrades gracefully to
  // id/raw-JSON while it loads or if it's unavailable.
  const schemasQuery = useQuery({
    queryKey: dataQueryKeys.schemas(tenant, context),
    queryFn: () => listAllSchemas(tenant, context),
  });

  // Audit-trail version history — the "version history" later-phase noted in
  // this page's header. Its own query so it loads/caches independently and a
  // failure here degrades to an inline error without blocking the record view.
  const versionsQuery = useQuery({
    queryKey: dataQueryKeys.recordVersions(tenant, context, recordId),
    queryFn: async () => {
      // First page only — long histories are paged. Surface `hasMore` so the
      // audit trail never silently looks complete when it isn't.
      const page = await vectrosApiClient(tenant, context).records.getRecordVersions({
        id: recordId,
      });
      return { versions: page.data ?? [], hasMore: page.nextCursor != null };
    },
    enabled: recordId !== '',
  });

  // Archive / restore — the record lifecycle `status` (soft-retract: pulled
  // from search, kept + recoverable). PATCH sends ONLY the status; merge-patch
  // preserves the payload and every omitted field.
  const statusMutation = useMutation({
    mutationFn: (status: 'ACTIVE' | 'ARCHIVED') =>
      vectrosApiClient(tenant, context).records.patchRecord({
        id: recordId,
        body: { status } as Vectros.RecordRequest,
      }),
    onSuccess: () => {
      const typeName = recordQuery.data?.typeName;
      if (typeName) {
        void queryClient.invalidateQueries({
          queryKey: dataQueryKeys.records(tenant, context, typeName),
        });
      }
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.record(tenant, context, recordId) });
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.recordVersions(tenant, context, recordId) });
      setArchiveConfirmOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => vectrosApiClient(tenant, context).records.deleteRecord({ id: recordId }),
    onSuccess: () => {
      const typeName = recordQuery.data?.typeName;
      if (typeName) {
        void queryClient.invalidateQueries({
          queryKey: dataQueryKeys.records(tenant, context, typeName),
        });
      }
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.record(tenant, context, recordId) });
      navigate(typeName ? `/records?type=${encodeURIComponent(typeName)}` : '/records');
    },
  });

  // Back to the list, preserving the record's type so the list lands on it
  // (matches the type the user filtered to). Falls back to the plain list while
  // the record is still loading / on error, when the type isn't known yet.
  const backTo = recordQuery.data?.typeName
    ? `/records?type=${encodeURIComponent(recordQuery.data.typeName)}`
    : '/records';
  const backButton = (
    <Button
      component={RouterLink}
      to={backTo}
      startIcon={<ArrowBack />}
      size="small"
      sx={{ alignSelf: 'flex-start' }}
    >
      <FormattedMessage id="recordDetail.back" />
    </Button>
  );

  if (recordQuery.isPending) {
    return (
      <Stack spacing={3}>
        {backButton}
        <LoadingBlock label={intl.formatMessage({ id: 'recordDetail.loading' })} />
      </Stack>
    );
  }

  if (recordQuery.isError) {
    return (
      <Stack spacing={3}>
        {backButton}
        <ApiErrorAlert error={recordQuery.error}>
          <FormattedMessage id="recordDetail.error" />
        </ApiErrorAlert>
      </Stack>
    );
  }

  const record = recordQuery.data;
  const payload = (record.payload ?? {}) as Record<string, unknown>;
  const payloadJson = JSON.stringify(record.payload ?? {}, null, 2);

  // Resolve the record's schema (cached; may still be loading) for the
  // field-model–driven enhancements below.
  const activeSchema: SchemaResponse | undefined = (schemasQuery.data ?? []).find(
    (s) => s.typeName === record.typeName,
  );
  const schemaFields = activeSchema?.fields ?? [];
  const renderHints = activeSchema?.renderHints;

  // displayField headline: the display field's value becomes the page
  // title, falling back to the raw id when unset/blank or the schema is absent.
  const displayFieldId = findDisplayFieldId(schemaFields, renderHints);
  const rawHeadline = displayFieldId ? payload[displayFieldId] : undefined;
  const headlineTitle =
    rawHeadline === undefined || rawHeadline === null || rawHeadline === ''
      ? undefined
      : // Same formatter as the list headline so an object/array displayField
        // renders compact JSON, not `[object Object]`.
        formatCellValue(rawHeadline);

  // Reference cross-links: the schema's reference fields paired with their
  // normalized values, keeping only those that carry a value in this payload.
  // Resolved to the target record's detail by <ReferenceLink>.
  const referenceRows = deriveReferenceFields(schemaFields, renderHints)
    .map((rf) => ({ rf, values: referenceValues(payload[rf.fieldId]) }))
    .filter((row) => row.values.length > 0);

  return (
    <Stack spacing={3}>
      {backButton}

      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: { sm: 'flex-start' },
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="h4"
            component="h1"
            sx={{
              fontWeight: 700,
              wordBreak: 'break-all',
              // The raw id is monospace; a human-readable displayField title isn't.
              ...(headlineTitle ? {} : { fontFamily: 'monospace' }),
            }}
          >
            {headlineTitle ?? record.id ?? intl.formatMessage({ id: 'recordDetail.untitled' })}
          </Typography>
          {(record.typeName || (headlineTitle && record.id)) && (
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
              {record.typeName && (
                <Typography variant="body2" color="text.secondary">
                  {record.typeName}
                </Typography>
              )}
              {/* When a displayField title replaces the id, keep the id visible. */}
              {headlineTitle && record.id && (
                <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                  {record.id}
                </Typography>
              )}
            </Stack>
          )}
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          <Button
            component={RouterLink}
            to={`/records/${encodeURIComponent(record.id ?? recordId)}/edit`}
            startIcon={<EditOutlined />}
            variant="outlined"
            size="small"
          >
            <FormattedMessage id="recordDetail.edit" />
          </Button>
          {record.status === 'ARCHIVED' ? (
            <Button
              startIcon={<UnarchiveOutlined />}
              variant="outlined"
              size="small"
              onClick={() => statusMutation.mutate('ACTIVE')}
              disabled={statusMutation.isPending}
            >
              <FormattedMessage id="recordDetail.restore" />
            </Button>
          ) : (
            <Button
              startIcon={<ArchiveOutlined />}
              variant="outlined"
              size="small"
              onClick={() => setArchiveConfirmOpen(true)}
            >
              <FormattedMessage id="recordDetail.archive" />
            </Button>
          )}
          <Button
            startIcon={<DeleteOutline />}
            color="error"
            variant="outlined"
            size="small"
            onClick={() => setConfirmOpen(true)}
          >
            <FormattedMessage id="recordDetail.delete" />
          </Button>
        </Stack>
      </Box>

      {/* Archived state — say what it means and how to undo it. */}
      {record.status === 'ARCHIVED' && (
        <Alert severity="warning">
          <FormattedMessage id="recordDetail.archivedBanner" />
        </Alert>
      )}
      {/* Restore failures surface here (archive failures show in its dialog). */}
      {statusMutation.isError && !archiveConfirmOpen && (
        <ApiErrorAlert error={statusMutation.error}>
          <FormattedMessage id="recordDetail.restoreError" />
        </ApiErrorAlert>
      )}

      <Card>
        <CardContent>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
            <FormattedMessage id="recordDetail.metaTitle" />
          </Typography>
          <MetaList>
            <MetaRow label={intl.formatMessage({ id: 'recordDetail.fieldStatus' })}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2">{recordStatusLabel(intl, record.status)}</Typography>
                {record.indexStatus && (
                  <Chip
                    size="small"
                    label={indexStatusLabel(intl, record.indexStatus)}
                    variant="outlined"
                  />
                )}
              </Stack>
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'recordDetail.fieldSchema' })}>
              {record.schemaId ? (
                <Link
                  component={RouterLink}
                  to={`/schemas/${encodeURIComponent(record.schemaId)}`}
                  variant="body2"
                  sx={{ fontFamily: 'monospace' }}
                >
                  {record.schemaId}
                </Link>
              ) : (
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  —
                </Typography>
              )}
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'recordDetail.fieldVersion' })}>
              <Typography variant="body2">{record.version ?? '—'}</Typography>
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'recordDetail.fieldOwner' })}>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {record.userId ?? record.orgId ?? record.clientId ?? '—'}
              </Typography>
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'recordDetail.fieldScopes' })}>
              <OwnershipScopeChips scopes={record.scopes} />
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'recordDetail.fieldFolder' })}>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {record.folderId ?? '—'}
              </Typography>
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'recordDetail.fieldCreated' })}>
              <Typography variant="body2">
                {record.createdAt ? (
                  <FormattedDate
                    value={record.createdAt}
                    year="numeric"
                    month="short"
                    day="numeric"
                    hour="2-digit"
                    minute="2-digit"
                  />
                ) : (
                  '—'
                )}
              </Typography>
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'recordDetail.fieldUpdated' })}>
              <Typography variant="body2">
                {record.updatedAt ? (
                  <FormattedDate
                    value={record.updatedAt}
                    year="numeric"
                    month="short"
                    day="numeric"
                    hour="2-digit"
                    minute="2-digit"
                  />
                ) : (
                  '—'
                )}
              </Typography>
            </MetaRow>
          </MetaList>
        </CardContent>
      </Card>

      {referenceRows.length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
              <FormattedMessage id="recordDetail.referencesTitle" />
            </Typography>
            <MetaList>
              {referenceRows.map(({ rf, values }) => (
                <MetaRow key={rf.fieldId} label={rf.label}>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                    {values.map((value, i) => (
                      <ReferenceLink
                        key={`${value}-${i}`}
                        targetTypeName={rf.targetTypeName}
                        targetField={rf.targetField}
                        value={value}
                      />
                    ))}
                  </Stack>
                </MetaRow>
              ))}
            </MetaList>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
            <FormattedMessage id="recordDetail.payloadTitle" />
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 2,
              borderRadius: 1,
              backgroundColor: 'action.hover',
              overflowX: 'auto',
              fontSize: '0.8125rem',
              fontFamily: 'monospace',
            }}
          >
            {payloadJson}
          </Box>
        </CardContent>
      </Card>

      <Card component="section" aria-label={intl.formatMessage({ id: 'history.title' })}>
        <CardContent>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
            <FormattedMessage id="history.title" />
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            <FormattedMessage id="history.subtitle" />
          </Typography>
          {versionsQuery.isPending ? (
            <LoadingBlock label={intl.formatMessage({ id: 'history.loading' })} py={3} size={24} />
          ) : versionsQuery.isError ? (
            <ApiErrorAlert error={versionsQuery.error}>
              <FormattedMessage id="history.error" />
            </ApiErrorAlert>
          ) : (
            <VersionHistory
              versions={versionsQuery.data.versions}
              hasMore={versionsQuery.data.hasMore}
            />
          )}
        </CardContent>
      </Card>

      {/* Archive is reversible but changes search visibility — confirm it and
          say exactly what happens (restore is one click, no confirm). */}
      <ConfirmDialog
        open={archiveConfirmOpen}
        onClose={() => {
          setArchiveConfirmOpen(false);
          statusMutation.reset(); // drop a prior failure so reopening starts clean
        }}
        onConfirm={() => statusMutation.mutate('ARCHIVED')}
        pending={statusMutation.isPending}
        title={<FormattedMessage id="recordDetail.archiveConfirmTitle" />}
        body={
          <FormattedMessage
            id="recordDetail.archiveConfirmBody"
            values={{ title: headlineTitle ?? record.id ?? '' }}
          />
        }
        confirmLabel={<FormattedMessage id="recordDetail.archiveConfirm" />}
        cancelLabel={<FormattedMessage id="recordDetail.deleteCancel" />}
        error={
          statusMutation.isError ? (
            <>
              <FormattedMessage id="recordDetail.archiveError" />
              <RequestIdCaption error={statusMutation.error} />
            </>
          ) : undefined
        }
      />

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
          deleteMutation.reset(); // drop a prior failure so reopening starts clean
        }}
        onConfirm={() => deleteMutation.mutate()}
        pending={deleteMutation.isPending}
        title={<FormattedMessage id="recordDetail.deleteConfirmTitle" />}
        body={<FormattedMessage id="recordDetail.deleteConfirmBody" />}
        confirmLabel={<FormattedMessage id="recordDetail.deleteConfirm" />}
        cancelLabel={<FormattedMessage id="recordDetail.deleteCancel" />}
        error={
          deleteMutation.isError ? (
            <>
              <FormattedMessage id="recordDetail.deleteError" />
              <RequestIdCaption error={deleteMutation.error} />
            </>
          ) : undefined
        }
      />
    </Stack>
  );
}
