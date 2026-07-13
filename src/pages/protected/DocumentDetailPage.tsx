// ---------------------------------------------------------------------------
// DocumentDetailPage — read-only document view (path: `/documents/:documentId`).
//
// Shows a document's details (title, type, status, indexing mode, folder,
// ownership, file type/size, version, timestamps), its typed metadata (the
// schema-validated `payload`, labelled and ordered by the schema, with
// undeclared free-form keys as JSON), and its text body (when the document
// stored it — `getDocumentText`) in a rendered-Markdown / raw toggle view (see
// MarkdownView for the safety posture; large bodies default to raw). A
// "download original" action mints a short-lived signed URL on demand
// (`getDocumentDownloadUrl`) and opens it.
//
// Writes: edit metadata (title + folder via DocumentEditDialog), delete
// (confirm-gated), archive/restore (the document lifecycle `status` —
// archiving soft-retracts the document from search/recall while keeping it
// retrievable), and — for file-backed documents created with an `externalId` —
// "Replace file": re-initiating the upload with the same externalId re-issues
// a presigned URL to the SAME document, and the new bytes re-extract and
// re-index it. Renders inside RequireContext, so the active context is
// resolved.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import ArchiveOutlined from '@mui/icons-material/ArchiveOutlined';
import ArrowBack from '@mui/icons-material/ArrowBack';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import EditOutlined from '@mui/icons-material/EditOutlined';
import FileDownload from '@mui/icons-material/FileDownload';
import UnarchiveOutlined from '@mui/icons-material/UnarchiveOutlined';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { ConfirmDialog, LoadingBlock, MetaList, MetaRow } from '@vectros-ai/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveContextId, useActiveTenantId } from '../../auth';
import { vectrosApiClient } from '../../api/vectrosApi';
import type { FolderResponse, Vectros } from '../../api/vectrosApi';
import { dataQueryKeys } from '../../lib/dataQueryKeys';
import {
  documentIndexStatusColor,
  documentIndexStatusLabel,
  documentStatusLabel,
} from '../../lib/documentLabels';
import { formatBytes } from '../../lib/formatBytes';
import { MAX_UPLOAD_BYTES } from '../../lib/uploadLimits';
import { drainPages } from '../../lib/drainPages';
import { listAllSchemas } from '../../lib/listAllSchemas';
import {
  defaultTextView,
  isInlineViewableMarkdownFile,
  orderedPayloadFields,
} from '../../lib/documentTypes';
import { formatCellValue } from '../../lib/recordColumns';
import { fieldLabel } from '../../lib/recordForm';
import { MarkdownView } from '../../components/MarkdownView';
import { DocumentEditDialog } from '../../components/DocumentEditDialog';
import { DocumentAskDrawer } from '../../components/DocumentAskDrawer';
import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { RequestIdCaption } from '../../components/RequestIdCaption';
import { VersionHistory } from '../../components/VersionHistory';
import { OwnershipScopeChips } from '../../components/OwnershipScopeChips';

export function DocumentDetailPage(): React.JSX.Element {
  const tenant = useActiveTenantId();
  const context = useActiveContextId();
  const intl = useIntl();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { documentId = '' } = useParams();

  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  // The hidden file input driving "Replace file" (re-upload → re-index).
  const replaceInputRef = useRef<HTMLInputElement>(null);
  // The text card's view mode. null = "not chosen yet" — the effective view is
  // then derived from the Markdown-detection default once the text is known.
  const [textView, setTextView] = useState<'rendered' | 'raw' | null>(null);
  // File-mode docs have no stored text; viewing them in-app is opt-in per
  // document (a click fetches the original via its presigned URL).
  const [fileViewRequested, setFileViewRequested] = useState(false);

  // Same-route param changes reuse this component instance — start each
  // document with a fresh toggle + no pending file fetch.
  useEffect(() => {
    setTextView(null);
    setFileViewRequested(false);
  }, [documentId]);

  const documentQuery = useQuery({
    queryKey: dataQueryKeys.document(tenant, context, documentId),
    queryFn: () => vectrosApiClient(tenant, context).documents.getDocument({ id: documentId }),
    enabled: documentId !== '',
  });

  // The document's schema resolves its typeName + drives the typed-metadata
  // panel. Cheap + cached (shared with the list surfaces); the view degrades
  // gracefully to raw payload JSON while loading or on failure.
  const schemasQuery = useQuery({
    queryKey: dataQueryKeys.schemas(tenant, context),
    queryFn: () => listAllSchemas(tenant, context),
  });

  // Folders feed the edit dialog's folder picker.
  const foldersQuery = useQuery({
    queryKey: dataQueryKeys.folders(tenant, context),
    queryFn: () =>
      drainPages<FolderResponse>(
        async (startFrom) =>
          (
            await vectrosApiClient(tenant, context).folders.listFolders(
              startFrom === undefined ? { limit: 100 } : { startFrom, limit: 100 },
            )
          ).data ?? [], // `{ data, nextCursor }` page envelope → items array
        (f) => f.id,
        100,
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      vectrosApiClient(tenant, context).documents.deleteDocument({ id: documentId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.documents(tenant, context) });
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.document(tenant, context, documentId) });
      // Land on the by-type view the user came from when the type is known
      // (mirrors the records explorer's delete).
      const deletedTypeName = (schemasQuery.data ?? []).find(
        (s) => s.id !== undefined && s.id === documentQuery.data?.schemaId,
      )?.typeName;
      navigate(
        deletedTypeName
          ? `/documents?type=${encodeURIComponent(deletedTypeName)}`
          : '/documents',
      );
    },
  });

  const doc = documentQuery.data;
  const hasText = doc?.storeText === true;

  // Archive / restore — the document lifecycle `status`. Archiving soft-
  // retracts the document (pulled from search + AI recall, kept + recoverable);
  // restoring re-indexes it. PATCH sends ONLY the status: merge-patch preserves
  // omitted fields, so no title carry-forward is needed (the shared
  // DocumentRequest type requires `title` for PUT, hence the cast).
  const statusMutation = useMutation({
    mutationFn: (status: 'ACTIVE' | 'ARCHIVED') =>
      vectrosApiClient(tenant, context).documents.patchDocument({
        id: documentId,
        body: { status } as Vectros.DocumentRequest,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.document(tenant, context, documentId) });
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.documents(tenant, context) });
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.documentVersions(tenant, context, documentId) });
      setArchiveConfirmOpen(false);
    },
  });

  // Replace file — re-initiate the upload with the document's own externalId.
  // The API re-issues a presigned URL to the SAME document (idempotent by
  // externalId), and uploading new bytes re-extracts + re-indexes it. Only
  // possible when the document was created WITH an externalId — that key IS
  // the re-upload identity, so a document without one has no replace path.
  const replaceMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!doc?.externalId) throw new Error('document has no externalId');
      // Backstop mirror of the add-document guard: an oversize file would PUT
      // "successfully" then land in FAILED at index time with no explanation.
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error(intl.formatMessage({ id: 'addDocument.fileTooLarge' }));
      }
      const client = vectrosApiClient(tenant, context);
      const fileType = file.type || 'application/octet-stream';
      const issued = await client.documents.uploadDocument({
        fileName: file.name,
        fileType,
        externalId: doc.externalId,
        // A typed document's externalId lives in its type's namespace — the
        // re-upload must name the same schema to match the existing document
        // (instead of falling through to a fresh, schemaless create).
        ...(doc.schemaId ? { schemaId: doc.schemaId } : {}),
      });
      if (!issued.uploadUrl) throw new Error('upload did not return a presigned URL');
      // PUT the raw bytes straight to S3 — the presigned URL is self-
      // authenticating, so NO Authorization header (one would break the
      // signature). Content-Type must match the fileType we declared.
      const put = await fetch(issued.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': fileType },
        body: file,
      });
      if (!put.ok) throw new Error(`file upload failed: ${put.status}`);
    },
    onSuccess: () => {
      // Extraction/re-indexing is asynchronous — the refreshed document shows
      // the in-flight indexStatus; the stored text + preview refresh once done.
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.document(tenant, context, documentId) });
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.documents(tenant, context) });
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.documentText(tenant, context, documentId) });
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.documentFileText(tenant, context, documentId) });
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.documentVersions(tenant, context, documentId) });
    },
  });

  const handleReplaceFilePicked = (file: File | undefined): void => {
    if (file) replaceMutation.mutate(file);
    // Allow re-picking the same file later (onChange fires only on change).
    if (replaceInputRef.current) replaceInputRef.current.value = '';
  };

  // Extracted text is a separate endpoint, fetched only when the document stored
  // it. Keyed independently so it caches/invalidates on its own.
  const textQuery = useQuery({
    queryKey: dataQueryKeys.documentText(tenant, context, documentId),
    queryFn: () => vectrosApiClient(tenant, context).documents.getDocumentText({ id: documentId }),
    enabled: documentId !== '' && hasText,
  });

  // The click-to-view path for file-mode Markdown docs (no stored text): mint
  // the short-lived presigned URL, then fetch the original client-side (the
  // upload bucket's CORS allows browser GETs). Enabled only after the user
  // asks — a page view must not silently pull the file.
  const fileViewEligible =
    doc !== undefined &&
    !hasText &&
    isInlineViewableMarkdownFile(doc.title, doc.fileType, doc.fileSize);
  const fileTextQuery = useQuery({
    queryKey: dataQueryKeys.documentFileText(tenant, context, documentId),
    queryFn: async () => {
      const res = await vectrosApiClient(tenant, context).documents.getDocumentDownloadUrl({
        id: documentId,
      });
      if (!res.downloadUrl) throw new Error('no download URL');
      const resp = await fetch(res.downloadUrl);
      if (!resp.ok) throw new Error(`file fetch failed: ${resp.status}`);
      return resp.text();
    },
    enabled: documentId !== '' && fileViewRequested && fileViewEligible,
  });

  // Audit-trail version history — its own query so a failure degrades to an
  // inline error without blocking the document view.
  const versionsQuery = useQuery({
    queryKey: dataQueryKeys.documentVersions(tenant, context, documentId),
    queryFn: async () => {
      // First page only; `hasMore` keeps a long audit trail from looking complete.
      const page = await vectrosApiClient(tenant, context).documents.getDocumentVersions({
        id: documentId,
      });
      return { versions: page.data ?? [], hasMore: page.nextCursor != null };
    },
    enabled: documentId !== '',
  });

  const handleDownload = async (): Promise<void> => {
    setDownloading(true);
    setDownloadError(false);
    try {
      const res = await vectrosApiClient(tenant, context).documents.getDocumentDownloadUrl({
        id: documentId,
      });
      if (res.downloadUrl) {
        window.open(res.downloadUrl, '_blank', 'noopener,noreferrer');
      } else {
        setDownloadError(true);
      }
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  };

  // Resolve the document's schema → typeName (undefined while schemas load, or
  // for a schemaless document).
  const docSchema = (schemasQuery.data ?? []).find(
    (s) => s.id !== undefined && s.id === documentQuery.data?.schemaId,
  );
  const typeName = docSchema?.typeName;

  // Back to the list, preserving the document's type so the list lands on the
  // by-type view the user came from (mirrors the records explorer).
  const backButton = (
    <Button
      component={RouterLink}
      to={typeName ? `/documents?type=${encodeURIComponent(typeName)}` : '/documents'}
      startIcon={<ArrowBack />}
      size="small"
      sx={{ alignSelf: 'flex-start' }}
    >
      <FormattedMessage id="documentDetail.back" />
    </Button>
  );

  if (documentQuery.isPending) {
    return (
      <Stack spacing={3}>
        {backButton}
        <LoadingBlock label={intl.formatMessage({ id: 'documentDetail.loading' })} />
      </Stack>
    );
  }

  if (documentQuery.isError || !doc) {
    return (
      <Stack spacing={3}>
        {backButton}
        <ApiErrorAlert error={documentQuery.error}>
          <FormattedMessage id="documentDetail.error" />
        </ApiErrorAlert>
      </Stack>
    );
  }

  // File-backed documents (those with a captured MIME type) can be downloaded.
  const isFileBacked = typeof doc.fileType === 'string' && doc.fileType.length > 0;

  // Typed metadata: the payload split into schema-declared fields (labelled +
  // ordered by the schema) and undeclared free-form pass-through keys (JSON).
  // Blank declared fields are dropped rather than rendered as dashes — sparse
  // payloads are the norm. A by-id GET carries the FULL payload even when list
  // responses externalize it, so this view is never the truncated subset.
  const payload = (doc.payload ?? {}) as Record<string, unknown>;
  const schemaFields = docSchema?.fields ?? [];
  const renderHints = docSchema?.renderHints;
  const declaredRows = orderedPayloadFields(schemaFields, renderHints)
    .map((f) => ({
      fieldId: f.fieldId,
      label: fieldLabel(f, renderHints),
      value: payload[f.fieldId],
    }))
    .filter((row) => row.value !== undefined && row.value !== null && row.value !== '');
  const declaredIds = new Set(schemaFields.map((f) => f.fieldId));
  const undeclaredEntries = Object.entries(payload).filter(([key]) => !declaredIds.has(key));
  const showMetadata = declaredRows.length > 0 || undeclaredEntries.length > 0;

  // The body text: the stored extracted text when the document kept it, else
  // the click-fetched original of a file-mode doc. The effective view is the
  // user's explicit toggle, else the detection default. Size = the API's byte
  // count when present (UTF-16 length under-counts multi-byte text, so it's
  // only the fallback).
  const text = hasText ? (textQuery.data?.text ?? '') : (fileTextQuery.data ?? '');
  const bodySizeBytes = (hasText ? doc.textBytes : doc.fileSize) ?? text.length;
  const effectiveTextView = textView ?? defaultTextView(doc.title, doc.fileType, bodySizeBytes);
  const bodyLoaded = hasText ? textQuery.isSuccess : fileTextQuery.isSuccess;

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
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700, wordBreak: 'break-word' }}>
            {doc.title && doc.title.length > 0
              ? doc.title
              : intl.formatMessage({ id: 'documentDetail.untitled' })}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
            {typeName && (
              <Typography variant="body2" color="text.secondary">
                {typeName}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              {doc.id}
            </Typography>
          </Stack>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          <Button variant="outlined" size="small" onClick={() => setAskOpen(true)}>
            <FormattedMessage id="ai.docAsk.button" />
          </Button>
          <Button
            startIcon={<EditOutlined />}
            variant="outlined"
            size="small"
            onClick={() => setEditOpen(true)}
          >
            <FormattedMessage id="documentDetail.edit" />
          </Button>
          {doc.status === 'ARCHIVED' ? (
            <Button
              startIcon={<UnarchiveOutlined />}
              variant="outlined"
              size="small"
              onClick={() => statusMutation.mutate('ACTIVE')}
              disabled={statusMutation.isPending}
            >
              <FormattedMessage id="documentDetail.restore" />
            </Button>
          ) : (
            <Button
              startIcon={<ArchiveOutlined />}
              variant="outlined"
              size="small"
              onClick={() => setArchiveConfirmOpen(true)}
            >
              <FormattedMessage id="documentDetail.archive" />
            </Button>
          )}
          <Button
            startIcon={<DeleteOutline />}
            color="error"
            variant="outlined"
            size="small"
            onClick={() => setConfirmOpen(true)}
          >
            <FormattedMessage id="documentDetail.delete" />
          </Button>
        </Stack>
      </Box>

      {/* Archived state — say what it means and how to undo it. */}
      {doc.status === 'ARCHIVED' && (
        <Alert severity="warning">
          <FormattedMessage id="documentDetail.archivedBanner" />
        </Alert>
      )}
      {/* Restore failures surface here (archive failures show in its dialog). */}
      {statusMutation.isError && !archiveConfirmOpen && (
        <ApiErrorAlert error={statusMutation.error}>
          <FormattedMessage id="documentDetail.restoreError" />
        </ApiErrorAlert>
      )}

      {/* Metadata */}
      <Card>
        <CardContent>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
            <FormattedMessage id="documentDetail.metaTitle" />
          </Typography>
          <MetaList>
            <MetaRow label={intl.formatMessage({ id: 'documentDetail.fieldStatus' })}>
              {/* Lifecycle status (caller-controlled) + the processing state
                  as a chip — the same split the record detail shows. */}
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2">{documentStatusLabel(intl, doc.status)}</Typography>
                {doc.indexStatus && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={documentIndexStatusLabel(intl, doc.indexStatus)}
                    color={documentIndexStatusColor(doc.indexStatus)}
                  />
                )}
              </Stack>
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'documentDetail.fieldIndexMode' })}>
              <Typography variant="body2">{doc.indexMode ?? '—'}</Typography>
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'documentDetail.fieldExternalId' })}>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {doc.externalId ?? '—'}
              </Typography>
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'documentDetail.fieldFolder' })}>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {doc.folderId ?? '—'}
              </Typography>
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'documentDetail.fieldOwner' })}>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {doc.userId ?? doc.orgId ?? doc.clientId ?? '—'}
              </Typography>
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'documentDetail.fieldScopes' })}>
              <OwnershipScopeChips scopes={doc.scopes} />
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'documentDetail.fieldType' })}>
              <Typography variant="body2">{doc.fileType ?? '—'}</Typography>
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'documentDetail.fieldSize' })}>
              <Typography variant="body2">{formatBytes(doc.fileSize)}</Typography>
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'documentDetail.fieldVersion' })}>
              <Typography variant="body2">{doc.version ?? '—'}</Typography>
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'documentDetail.fieldCreated' })}>
              <Typography variant="body2">
                {doc.createdAt ? (
                  <FormattedDate
                    value={doc.createdAt}
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
            <MetaRow label={intl.formatMessage({ id: 'documentDetail.fieldUpdated' })}>
              <Typography variant="body2">
                {doc.lastModified ? (
                  <FormattedDate
                    value={doc.lastModified}
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

          {isFileBacked && (
            <Stack spacing={1} sx={{ mt: 2 }}>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<FileDownload />}
                  onClick={() => void handleDownload()}
                  disabled={downloading}
                >
                  <FormattedMessage
                    id={downloading ? 'documentDetail.downloading' : 'documentDetail.download'}
                  />
                </Button>
                {/* Replace file (re-upload → re-extract → re-index). Keyed on the
                    document's externalId, so a document created without one has
                    no replace path — teach that instead of hiding the action. */}
                <input
                  ref={replaceInputRef}
                  type="file"
                  hidden
                  aria-label={intl.formatMessage({ id: 'documentDetail.replaceFileAria' })}
                  onChange={(e) => handleReplaceFilePicked(e.target.files?.[0])}
                />
                {doc.externalId ? (
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<UploadFileIcon />}
                    onClick={() => replaceInputRef.current?.click()}
                    disabled={replaceMutation.isPending}
                  >
                    <FormattedMessage
                      id={
                        replaceMutation.isPending
                          ? 'documentDetail.replaceFileUploading'
                          : 'documentDetail.replaceFile'
                      }
                    />
                  </Button>
                ) : (
                  <Tooltip title={intl.formatMessage({ id: 'documentDetail.replaceFileNoExternalId' })}>
                    {/* span: MUI tooltips need an enabled wrapper around a disabled button */}
                    <span>
                      <Button variant="outlined" size="small" startIcon={<UploadFileIcon />} disabled>
                        <FormattedMessage id="documentDetail.replaceFile" />
                      </Button>
                    </span>
                  </Tooltip>
                )}
              </Stack>
              {downloadError && (
                <Alert severity="error" role="alert" sx={{ alignSelf: 'flex-start' }}>
                  <FormattedMessage id="documentDetail.downloadError" />
                </Alert>
              )}
              {replaceMutation.isSuccess && (
                <Alert severity="success" sx={{ alignSelf: 'flex-start' }}>
                  <FormattedMessage id="documentDetail.replaceFileSuccess" />
                </Alert>
              )}
              {replaceMutation.isError && (
                <ApiErrorAlert error={replaceMutation.error}>
                  <FormattedMessage id="documentDetail.replaceFileError" />
                </ApiErrorAlert>
              )}
            </Stack>
          )}
        </CardContent>
      </Card>

      {/* Typed metadata — the document's structured payload: schema-declared
          fields labelled/ordered by the schema, free-form keys as JSON. */}
      {showMetadata && (
        <Card>
          <CardContent>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
              <FormattedMessage id="documentDetail.metadataTitle" />
            </Typography>
            {declaredRows.length > 0 && (
              <MetaList>
                {declaredRows.map((row) => (
                  <MetaRow key={row.fieldId} label={row.label}>
                    <Typography variant="body2">{formatCellValue(row.value)}</Typography>
                  </MetaRow>
                ))}
              </MetaList>
            )}
            {undeclaredEntries.length > 0 && (
              <>
                {declaredRows.length > 0 && (
                  <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>
                    <FormattedMessage id="documentDetail.metadataOther" />
                  </Typography>
                )}
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
                  {JSON.stringify(Object.fromEntries(undeclaredEntries), null, 2)}
                </Box>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Text body — rendered-Markdown / raw toggle over the stored text. */}
      <Card>
        <CardContent>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              mb: 1,
            }}
          >
            <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
              <FormattedMessage id="documentDetail.textTitle" />
            </Typography>
            {bodyLoaded && text.length > 0 && (
              <ToggleButtonGroup
                size="small"
                exclusive
                value={effectiveTextView}
                onChange={(_e, next: 'rendered' | 'raw' | null) => {
                  if (next !== null) setTextView(next);
                }}
                aria-label={intl.formatMessage({ id: 'documentDetail.viewAria' })}
              >
                <ToggleButton value="rendered">
                  <FormattedMessage id="documentDetail.viewRendered" />
                </ToggleButton>
                <ToggleButton value="raw">
                  <FormattedMessage id="documentDetail.viewRaw" />
                </ToggleButton>
              </ToggleButtonGroup>
            )}
          </Box>
          {!hasText && !fileViewRequested ? (
            // No stored text: a viewable file-mode doc gets a positive
            // click-to-view offer (the content IS the file — don't lead with
            // a storage-internals disclaimer); everything else explains why
            // there's nothing to show, with download as the remaining path.
            <Stack spacing={1} alignItems="flex-start">
              <Typography variant="body2" color="text.secondary">
                <FormattedMessage
                  id={
                    fileViewEligible ? 'documentDetail.fileViewIntro' : 'documentDetail.textNotStored'
                  }
                />
              </Typography>
              {fileViewEligible && (
                <Button variant="outlined" size="small" onClick={() => setFileViewRequested(true)}>
                  <FormattedMessage id="documentDetail.fileViewLoad" />
                </Button>
              )}
            </Stack>
          ) : (hasText ? textQuery.isPending : fileTextQuery.isPending) ? (
            <LoadingBlock
              label={intl.formatMessage({ id: 'documentDetail.textLoading' })}
              py={3}
              size={24}
            />
          ) : hasText && textQuery.isError ? (
            <ApiErrorAlert error={textQuery.error}>
              <FormattedMessage id="documentDetail.textError" />
            </ApiErrorAlert>
          ) : !hasText && fileTextQuery.isError ? (
            <ApiErrorAlert error={fileTextQuery.error}>
              <FormattedMessage id="documentDetail.fileViewError" />
            </ApiErrorAlert>
          ) : text.length > 0 && effectiveTextView === 'rendered' ? (
            <MarkdownView>{text}</MarkdownView>
          ) : (
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 2,
                borderRadius: 1,
                backgroundColor: 'action.hover',
                overflowX: 'auto',
                maxHeight: 480,
                overflowY: 'auto',
                fontSize: '0.8125rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {text.length > 0 ? text : intl.formatMessage({ id: 'documentDetail.textEmpty' })}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Audit-trail history */}
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

      <DocumentEditDialog
        open={editOpen}
        document={doc}
        schema={docSchema}
        folders={foldersQuery.data ?? []}
        onClose={() => setEditOpen(false)}
      />

      {doc.id && (
        <DocumentAskDrawer
          open={askOpen}
          documentId={doc.id}
          documentTitle={doc.title}
          onClose={() => setAskOpen(false)}
        />
      )}

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
        title={<FormattedMessage id="documentDetail.archiveConfirmTitle" />}
        body={
          <FormattedMessage
            id="documentDetail.archiveConfirmBody"
            values={{
              title:
                doc.title && doc.title.length > 0
                  ? doc.title
                  : intl.formatMessage({ id: 'documentDetail.untitled' }),
            }}
          />
        }
        confirmLabel={<FormattedMessage id="documentDetail.archiveConfirm" />}
        cancelLabel={<FormattedMessage id="documentDetail.deleteCancel" />}
        error={
          statusMutation.isError ? (
            <>
              <FormattedMessage id="documentDetail.archiveError" />
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
        title={<FormattedMessage id="documentDetail.deleteConfirmTitle" />}
        body={<FormattedMessage id="documentDetail.deleteConfirmBody" />}
        confirmLabel={<FormattedMessage id="documentDetail.deleteConfirm" />}
        cancelLabel={<FormattedMessage id="documentDetail.deleteCancel" />}
        error={
          deleteMutation.isError ? (
            <>
              <FormattedMessage id="documentDetail.deleteError" />
              <RequestIdCaption error={deleteMutation.error} />
            </>
          ) : undefined
        }
      />
    </Stack>
  );
}
