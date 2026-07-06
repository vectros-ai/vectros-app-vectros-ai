// ---------------------------------------------------------------------------
// DocumentsPage — the document browser (path: `/documents`).
//
// Type is the primary browse axis (mirroring the records explorer): a type
// filter over the document-surface schemas drives schema-derived payload
// columns, client-side sort, a filter over the schema's `filterable` fields,
// and a SERVER-SIDE lookup panel (exact / range / prefix on the schema's
// lookup fields or `externalId`, via lookupDocumentsByBody — the shared
// LookupPanel). Folders are the secondary axis — the folder filter (the
// context's folder tree) composes with the type filter (but not with a
// lookup, which runs context-wide). Each document links to its detail
// (metadata + text viewer + signed download); the write actions — folder CRUD
// (FolderEditorDialog + the folder-management card) and document create
// (AddDocumentDialog: file upload via presigned PUT, or text ingest).
//
// Folder scoping is SERVER-SIDE: selecting a folder re-queries
// `listDocuments({folderId})` rather than draining every document and filtering
// in the browser — the right pattern for a reference app at scale. The query is
// keyed by the selected folder, so switching folders refetches that folder's
// page set (drained; the SDK default page size is 20). TYPE scoping is
// client-side over that drained set: `listDocuments` has no type/schema
// parameter, and a document carries its type only indirectly (`schemaId` →
// the schema's `typeName`), so the filter resolves that hop locally.
//
// The selected type lives in the URL (`?type=`) so it survives navigating to a
// document's detail and back. Renders inside RequireContext, so
// useActiveContextId() is safe here.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  Link,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import EditOutlined from '@mui/icons-material/EditOutlined';
import QuestionAnswerOutlined from '@mui/icons-material/QuestionAnswerOutlined';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { ConfirmDialog, LoadingBlock } from '@vectros-ai/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveContextId, useActiveTenantId } from '../../auth';
import { vectrosApiClient } from '../../api/vectrosApi';
import type { DocumentResponse, FolderResponse } from '../../api/vectrosApi';
import { dataQueryKeys } from '../../lib/dataQueryKeys';
import { drainPages } from '../../lib/drainPages';
import { listAllSchemas } from '../../lib/listAllSchemas';
import { documentSurfaceSchemas, typeNameBySchemaId } from '../../lib/documentTypes';
import {
  deriveValueColumns,
  filterableFieldIds,
  formatCellValue,
  payloadMatchesQuery,
  sortRecords,
} from '../../lib/recordColumns';
import type { SortDirection } from '../../lib/recordColumns';
import { orderFoldersAsTree } from '../../lib/folderTree';
import {
  documentIndexStatusColor,
  documentIndexStatusLabel,
  documentStatusLabel,
} from '../../lib/documentLabels';
import { formatBytes } from '../../lib/formatBytes';
import { FolderEditorDialog } from '../../components/FolderEditorDialog';
import { LookupPanel } from '../../components/LookupPanel';
import type { AppliedLookup, LookupFieldDef } from '../../components/LookupPanel';
import { AddDocumentDialog } from '../../components/AddDocumentDialog';
import { RefreshButton } from '../../components/RefreshButton';
import { DocumentAskDrawer } from '../../components/DocumentAskDrawer';
import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { RequestIdCaption } from '../../components/RequestIdCaption';
import { folderMenuItems } from '../../components/folderMenuItems';
import { statusCodeOf } from '../../lib/apiError';

/** Page size for the drained list endpoints — the API's max (default is 20). */
const PAGE_SIZE = 100;
/** Sentinel folder-filter value meaning "no folder filter". */
const ALL_FOLDERS = 'ALL';
/** Sentinel type-filter value meaning "all types" (no `?type=` in the URL). */
const ALL_TYPES = 'ALL';

/** Sentinel sort key for the (non-payload) "Updated" column. */
const UPDATED_SORT_KEY = '__updatedAt__';

/** A document's payload as a plain bag (the SDK types it loosely). */
function payloadOf(d: DocumentResponse): Record<string, unknown> | undefined {
  return d.payload as Record<string, unknown> | undefined;
}

export function DocumentsPage(): React.JSX.Element {
  const tenant = useActiveTenantId();
  const context = useActiveContextId();
  const intl = useIntl();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The selected type lives in the URL (`?type=`) so it survives a round-trip
  // through a document's detail page (mirrors the records explorer).
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedType = searchParams.get('type');
  const [filterQuery, setFilterQuery] = useState('');
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(null);
  const [folderFilter, setFolderFilter] = useState<string>(ALL_FOLDERS);
  // The APPLIED server-side lookup (null = plain list). Typed view only —
  // the lookup endpoint requires a document type. The in-progress inputs live
  // inside LookupPanel; it delivers a lookup here only on submit.
  const [appliedLookup, setAppliedLookup] = useState<AppliedLookup | null>(null);
  // The document targeted by a per-row "Ask" action (opens DocumentAskDrawer).
  const [askTarget, setAskTarget] = useState<DocumentResponse | null>(null);
  const [folderDialog, setFolderDialog] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    folder?: FolderResponse;
  }>({ open: false, mode: 'create' });
  const [deleteTarget, setDeleteTarget] = useState<FolderResponse | null>(null);
  const [addDocOpen, setAddDocOpen] = useState(false);

  const foldersQuery = useQuery({
    queryKey: dataQueryKeys.folders(tenant, context),
    queryFn: () =>
      drainPages<FolderResponse>(
        async (startFrom) =>
          (
            await vectrosApiClient(tenant, context).folders.listFolders(
              startFrom === undefined ? { limit: PAGE_SIZE } : { startFrom, limit: PAGE_SIZE },
            )
          ).data ?? [], // `{ data, nextCursor }` page envelope → items array
        (f) => f.id,
        PAGE_SIZE,
      ),
  });

  // Schemas drive the type filter + the typed view's payload columns. Cheap +
  // cached (shared key with the records/schemas surfaces); the page degrades
  // gracefully to the untyped list if this fails or is still loading.
  const schemasQuery = useQuery({
    queryKey: dataQueryKeys.schemas(tenant, context),
    queryFn: () => listAllSchemas(tenant, context),
  });

  // Server-side folder scoping: when a folder is selected, pass folderId;
  // when ALL, omit it. Keyed by the folder so a switch refetches cleanly.
  const scopedFolderId = folderFilter === ALL_FOLDERS ? undefined : folderFilter;
  const documentsQuery = useQuery({
    queryKey: dataQueryKeys.documents(tenant, context, scopedFolderId),
    queryFn: () =>
      drainPages<DocumentResponse>(
        async (startFrom) =>
          (
            await vectrosApiClient(tenant, context).documents.listDocuments({
              ...(scopedFolderId === undefined ? {} : { folderId: scopedFolderId }),
              ...(startFrom === undefined ? { limit: PAGE_SIZE } : { startFrom, limit: PAGE_SIZE }),
            })
          ).data ?? [], // `{ data, nextCursor }` page envelope → items array
        (d) => d.id,
        PAGE_SIZE,
      ),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (id: string) => vectrosApiClient(tenant, context).folders.deleteFolder({ id }),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.folders(tenant, context) });
      // A document may have referenced the folder — refresh the list too.
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.documents(tenant, context) });
      // If the just-deleted folder was the active filter, fall back to All so
      // the list doesn't strand on a now-gone folder's empty view (D6).
      if (folderFilter === id) setFolderFilter(ALL_FOLDERS);
      setDeleteTarget(null);
    },
  });

  const folders = foldersQuery.data ?? [];
  const folderTree = orderFoldersAsTree(folders);
  const folderNameById = new Map(folders.map((f) => [f.id ?? '', f.name ?? f.id ?? '']));

  // The server already scoped to the selected folder (or returned all of them).
  const documents: ReadonlyArray<DocumentResponse> = useMemo(
    () => documentsQuery.data ?? [],
    [documentsQuery.data],
  );

  // The selectable document types + the schemaId → typeName resolution for the
  // untyped view's Type column.
  const allSchemas = schemasQuery.data ?? [];
  const documentTypes = documentSurfaceSchemas(allSchemas);
  const typeNamesById = typeNameBySchemaId(allSchemas);

  // The active type's schema (undefined in the all-types view). A stale `?type=`
  // naming no current type degrades to the all-types view rather than erroring.
  const activeSchema =
    selectedType === null ? undefined : documentTypes.find((s) => s.typeName === selectedType);
  const schemaFields = activeSchema?.fields ?? [];
  const valueColumns = deriveValueColumns(schemaFields, activeSchema?.renderHints);
  const filterFieldIds = filterableFieldIds(schemaFields);

  // Lookup fields for the typed view: `externalId` always works (the document
  // identity key needs no schema declaration, exact-match only), plus the
  // schema's own lookup fields (range/prefix where `rangeEnabled`).
  const lookupDefs: ReadonlyArray<LookupFieldDef> = activeSchema
    ? [
        { fieldName: 'externalId', rangeEnabled: false },
        ...(activeSchema.lookupFields ?? [])
          .filter(
            (l): l is typeof l & { fieldName: string } =>
              typeof l.fieldName === 'string' && l.fieldName !== 'externalId',
          )
          .map((l) => ({ fieldName: l.fieldName, rangeEnabled: l.rangeEnabled === true })),
      ]
    : [];

  // Server-side lookup: exact / range / prefix on a lookup field, sorted by
  // `order`. Its own query (not folded into documentsQuery) because the plain
  // list DRAINS pages per folder while the lookup is one page (the API max)
  // over the WHOLE context — the folder filter does not apply to it.
  const lookupActive = appliedLookup !== null && activeSchema !== undefined;
  const lookupQuery = useQuery({
    queryKey: dataQueryKeys.documentsLookup(
      tenant,
      context,
      activeSchema?.typeName ?? '',
      JSON.stringify(appliedLookup),
    ),
    queryFn: async () => {
      if (!appliedLookup || !activeSchema) return [];
      const modeArgs =
        appliedLookup.mode === 'exact'
          ? { value: appliedLookup.value }
          : appliedLookup.mode === 'range'
            ? { from: appliedLookup.from, to: appliedLookup.to }
            : { prefix: appliedLookup.prefix };
      // POST-body lookup: works for exact/range/prefix uniformly and keeps a
      // sensitive field's value out of the URL query string.
      return (
        (
          await vectrosApiClient(tenant, context).documents.lookupDocumentsByBody({
            type: activeSchema.typeName,
            field: appliedLookup.field,
            ...modeArgs,
            order: appliedLookup.order,
            limit: PAGE_SIZE,
          })
        ).data ?? []
      );
    },
    enabled: lookupActive,
  });

  // Type scoping. With a lookup applied, the server already scoped the results
  // to the type (and the folder filter does NOT apply — a lookup runs over the
  // whole context). Otherwise it's client-side: a document carries only its
  // schemaId, so the typed view keeps the documents bound to the active type's
  // schema. The plain list is fully drained (not first-page-only), so this
  // filter sees every document in the current folder scope. Known limit
  // (shared with the records explorer): a payload big enough to be
  // externalized arrives on LIST responses as only its inline projection
  // (lookup + filterable fields), so a non-filterable value column can show —
  // for such a row; the detail view's by-id GET always has the full payload.
  const typedDocuments = useMemo(() => {
    if (lookupActive) return lookupQuery.data ?? [];
    return activeSchema ? documents.filter((d) => d.schemaId === activeSchema.id) : documents;
  }, [lookupActive, lookupQuery.data, documents, activeSchema]);

  // Apply the client-side filter (over filterable fields), then the active sort
  // — typed view only; the all-types view keeps the server's ordering.
  const displayedDocuments = useMemo(() => {
    if (!activeSchema) return typedDocuments;
    const filtered =
      filterQuery.trim() === '' || filterFieldIds.length === 0
        ? typedDocuments
        : typedDocuments.filter((d) => payloadMatchesQuery(payloadOf(d), filterQuery, filterFieldIds));
    if (!sort) return filtered;
    const accessor =
      sort.key === UPDATED_SORT_KEY
        ? (d: DocumentResponse) => d.lastModified
        : (d: DocumentResponse) => payloadOf(d)?.[sort.key];
    return sortRecords(filtered, accessor, sort.direction);
  }, [activeSchema, typedDocuments, filterQuery, filterFieldIds, sort]);

  const handleFolderChange = (event: SelectChangeEvent): void => {
    setFolderFilter(event.target.value);
  };

  const handleTypeChange = (event: SelectChangeEvent): void => {
    const next = new URLSearchParams(searchParams);
    if (event.target.value === ALL_TYPES) next.delete('type');
    else next.set('type', event.target.value);
    // replace (not push) so switching types doesn't stack history entries.
    setSearchParams(next, { replace: true });
    // Columns/filterable/lookup fields differ per type — reset sort, filter,
    // lookup. (LookupPanel's inputs reset via its `key` remount.)
    setSort(null);
    setFilterQuery('');
    setAppliedLookup(null);
  };

  const toggleSort = (key: string): void => {
    setSort((prev) =>
      prev?.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    );
  };

  /** A sortable column header cell (typed view). Keyed — callers render these from maps. */
  const sortableHeader = (key: string, label: React.ReactNode): React.JSX.Element => (
    <TableCell key={key} sortDirection={sort?.key === key ? sort.direction : false}>
      <TableSortLabel
        active={sort?.key === key}
        direction={sort?.key === key ? sort.direction : 'asc'}
        onClick={() => toggleSort(key)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  // "Ask this folder" — deep-link into the AI workspace with the folder pre-set
  // as the RAG scope (AskPage reads ?folderId=). Exact-folder scope (the subtree
  // variant is a separate follow-up); a missing id is a no-op.
  const askFolder = (folderId: string | undefined): void => {
    if (folderId) navigate(`/ai/ask?folderId=${encodeURIComponent(folderId)}`);
  };

  // Best-effort non-empty pre-warning before a folder delete (D1). Sub-folders
  // are always known (the folder tree is fully loaded); child DOCUMENTS are only
  // visible when the list isn't scoped to a different folder (server-side
  // scoping). The backend's 400 on a non-empty folder is the authoritative
  // guard either way (handled in the dialog's error branch).
  const canSeeTargetDocs = scopedFolderId === undefined || scopedFolderId === deleteTarget?.id;
  const deleteTargetHasContents =
    deleteTarget !== null &&
    (folders.some((f) => f.parentFolderId === deleteTarget.id) ||
      (canSeeTargetDocs && documents.some((d) => d.folderId === deleteTarget.id)));

  return (
    <Stack spacing={4}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: { sm: 'flex-start' },
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Box>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
            <FormattedMessage id="documents.title" />
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
            <FormattedMessage id="documents.subtitle" />
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
          <RefreshButton
            onClick={() => void (lookupActive ? lookupQuery.refetch() : documentsQuery.refetch())}
            loading={lookupActive ? lookupQuery.isFetching : documentsQuery.isFetching}
            label={intl.formatMessage({ id: 'documents.refresh' })}
          />
          <Button
            startIcon={<AddIcon />}
            variant="outlined"
            onClick={() => setFolderDialog({ open: true, mode: 'create' })}
          >
            <FormattedMessage id="documents.newFolder" />
          </Button>
          <Button
            startIcon={<UploadFileIcon />}
            variant="contained"
            onClick={() => setAddDocOpen(true)}
          >
            <FormattedMessage id="documents.addDocument" />
          </Button>
        </Stack>
      </Box>

      {/* Gate the page chrome (folder filter + management) on the folders load
          only — so switching folders reloads just the document-list region
          below, not the whole page (the filter stays usable mid-refetch). */}
      {foldersQuery.isPending ? (
        <LoadingBlock label={intl.formatMessage({ id: 'documents.loading' })} />
      ) : foldersQuery.isError ? (
        <ApiErrorAlert error={foldersQuery.error}>
          <FormattedMessage id="documents.foldersError" />
        </ApiErrorAlert>
      ) : (
        <>
          {/* Filters — type (primary axis), folder (secondary), and the typed
              view's free-text filter over the schema's filterable fields. */}
          {(documentTypes.length > 0 || folderTree.length > 0) && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
              {documentTypes.length > 0 && (
                <FormControl size="small" sx={{ minWidth: 240, maxWidth: 360 }}>
                  <InputLabel id="documents-type-label">
                    <FormattedMessage id="documents.typeLabel" />
                  </InputLabel>
                  <Select
                    labelId="documents-type-label"
                    label={intl.formatMessage({ id: 'documents.typeLabel' })}
                    value={activeSchema?.typeName ?? ALL_TYPES}
                    onChange={handleTypeChange}
                  >
                    <MenuItem value={ALL_TYPES}>
                      {intl.formatMessage({ id: 'documents.allTypes' })}
                    </MenuItem>
                    {documentTypes.map((s) => (
                      <MenuItem key={s.typeName} value={s.typeName}>
                        {s.displayName && s.displayName.length > 0 ? s.displayName : s.typeName}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              {folderTree.length > 0 && (
                <FormControl size="small" sx={{ minWidth: 240, maxWidth: 360 }}>
                  <InputLabel id="documents-folder-label">
                    <FormattedMessage id="documents.folderLabel" />
                  </InputLabel>
                  <Select
                    labelId="documents-folder-label"
                    label={intl.formatMessage({ id: 'documents.folderLabel' })}
                    value={folderFilter}
                    onChange={handleFolderChange}
                    // A lookup runs over the whole context — the folder filter
                    // doesn't apply to it, so don't pretend it does.
                    disabled={lookupActive}
                  >
                    <MenuItem value={ALL_FOLDERS}>
                      {intl.formatMessage({ id: 'documents.allFolders' })}
                    </MenuItem>
                    {folderMenuItems(folders)}
                  </Select>
                </FormControl>
              )}

              {activeSchema && filterFieldIds.length > 0 && (
                <TextField
                  size="small"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder={intl.formatMessage({ id: 'documents.filterPlaceholder' })}
                  slotProps={{
                    htmlInput: {
                      'aria-label': intl.formatMessage({ id: 'documents.filterAria' }),
                    },
                  }}
                  sx={{ minWidth: 240, maxWidth: 360 }}
                />
              )}
            </Box>
          )}

          {/* Server-side lookup — typed view only (the lookup endpoint requires
              a document type). `externalId` is always offered; the schema's
              lookup fields add range/prefix where enabled. Keyed on the type so
              the panel's inputs reset when the type changes. */}
          {activeSchema && (
            <LookupPanel
              key={activeSchema.typeName}
              defs={lookupDefs}
              applied={appliedLookup}
              onApply={setAppliedLookup}
              messagePrefix="documents"
              idPrefix="documents-lookup"
            />
          )}

          {/* Folder management — rename / delete (create is the header button). */}
          {folderTree.length > 0 && (
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
                  <FormattedMessage id="documents.foldersTitle" />
                </Typography>
                <Stack divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />}>
                  {folderTree.map(({ folder, depth }) => (
                    <Box
                      key={folder.id}
                      sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}
                    >
                      <Typography variant="body2" sx={{ flexGrow: 1, pl: depth * 2, minWidth: 0 }}>
                        {folder.name && folder.name.length > 0 ? folder.name : folder.id}
                      </Typography>
                      <Tooltip title={intl.formatMessage({ id: 'documents.askFolder' })}>
                        <IconButton
                          size="small"
                          onClick={() => askFolder(folder.id)}
                          aria-label={intl.formatMessage(
                            { id: 'documents.askFolderAria' },
                            { name: folder.name ?? folder.id ?? '' },
                          )}
                        >
                          <QuestionAnswerOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {folder.isProtected ? (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={intl.formatMessage({ id: 'documents.folderProtected' })}
                        />
                      ) : (
                        <>
                          <Tooltip title={intl.formatMessage({ id: 'documents.folderEdit' })}>
                            <IconButton
                              size="small"
                              onClick={() => setFolderDialog({ open: true, mode: 'edit', folder })}
                              aria-label={intl.formatMessage(
                                { id: 'documents.folderEditAria' },
                                { name: folder.name ?? folder.id ?? '' },
                              )}
                            >
                              <EditOutlined fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={intl.formatMessage({ id: 'documents.folderDelete' })}>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => setDeleteTarget(folder)}
                              aria-label={intl.formatMessage(
                                { id: 'documents.folderDeleteAria' },
                                { name: folder.name ?? folder.id ?? '' },
                              )}
                            >
                              <DeleteOutline fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}

          {/* Document list region — its own loading/error/empty, keyed to the
              folder-scoped list query (or the lookup query when a lookup is
              applied) so a filter change reloads only here. */}
          {(lookupActive ? lookupQuery.isPending : documentsQuery.isPending) ? (
            <LoadingBlock label={intl.formatMessage({ id: 'documents.loading' })} />
          ) : lookupActive && lookupQuery.isError ? (
            <ApiErrorAlert error={lookupQuery.error}>
              <FormattedMessage id="documents.lookupError" />
            </ApiErrorAlert>
          ) : !lookupActive && documentsQuery.isError ? (
            <ApiErrorAlert error={documentsQuery.error}>
              <FormattedMessage id="documents.error" />
            </ApiErrorAlert>
          ) : lookupActive && typedDocuments.length === 0 ? (
            <Alert severity="info">
              <FormattedMessage id="documents.noLookupMatch" />
            </Alert>
          ) : !lookupActive && documents.length === 0 ? (
            <Alert severity="info">
              <FormattedMessage
                id={folderFilter === ALL_FOLDERS ? 'documents.empty' : 'documents.emptyFolder'}
              />
            </Alert>
          ) : !lookupActive && activeSchema && typedDocuments.length === 0 ? (
            <Alert severity="info">
              <FormattedMessage id="documents.emptyType" />
            </Alert>
          ) : activeSchema && displayedDocuments.length === 0 ? (
            <Alert severity="info">
              <FormattedMessage id="documents.noFilterMatch" />
            </Alert>
          ) : (
            <Stack spacing={1}>
              <TableContainer component={Paper}>
              <Table size="small" aria-label={intl.formatMessage({ id: 'documents.tableLabel' })}>
                <TableHead>
                  {/* Typed view: title + the schema's payload columns (sortable).
                      All-types view: the stable cross-type columns, with Type
                      resolved from the document's schema. */}
                  <TableRow>
                    <TableCell>
                      <FormattedMessage id="documents.colTitle" />
                    </TableCell>
                    {activeSchema ? (
                      valueColumns.map((col) => sortableHeader(col.fieldId, col.label))
                    ) : (
                      <TableCell>
                        <FormattedMessage id="documents.colType" />
                      </TableCell>
                    )}
                    <TableCell>
                      <FormattedMessage id="documents.colStatus" />
                    </TableCell>
                    <TableCell>
                      <FormattedMessage id="documents.colIndex" />
                    </TableCell>
                    <TableCell>
                      <FormattedMessage id="documents.colFolder" />
                    </TableCell>
                    {!activeSchema && (
                      <TableCell align="right">
                        <FormattedMessage id="documents.colSize" />
                      </TableCell>
                    )}
                    {activeSchema ? (
                      sortableHeader(UPDATED_SORT_KEY, <FormattedMessage id="documents.colUpdated" />)
                    ) : (
                      <TableCell>
                        <FormattedMessage id="documents.colUpdated" />
                      </TableCell>
                    )}
                    <TableCell align="right">
                      <FormattedMessage id="documents.colActions" />
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {displayedDocuments.map((d) => (
                    <TableRow key={d.id} hover>
                      <TableCell>
                        {d.id ? (
                          <Link
                            component={RouterLink}
                            to={`/documents/${encodeURIComponent(d.id)}`}
                          >
                            {d.title && d.title.length > 0
                              ? d.title
                              : intl.formatMessage({ id: 'documents.untitled' })}
                          </Link>
                        ) : (
                          (d.title ?? '—')
                        )}
                      </TableCell>
                      {activeSchema ? (
                        valueColumns.map((col) => (
                          <TableCell key={col.fieldId}>
                            {formatCellValue(payloadOf(d)?.[col.fieldId])}
                          </TableCell>
                        ))
                      ) : (
                        <TableCell>
                          {(d.schemaId ? typeNamesById.get(d.schemaId) : undefined) ?? '—'}
                        </TableCell>
                      )}
                      <TableCell>{documentStatusLabel(intl, d.status)}</TableCell>
                      <TableCell>
                        {d.indexStatus ? (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={documentIndexStatusLabel(intl, d.indexStatus)}
                            color={documentIndexStatusColor(d.indexStatus)}
                          />
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        {d.folderId ? (folderNameById.get(d.folderId) ?? d.folderId) : '—'}
                      </TableCell>
                      {!activeSchema && (
                        <TableCell align="right">{formatBytes(d.fileSize)}</TableCell>
                      )}
                      <TableCell>
                        {d.lastModified ? (
                          <FormattedDate
                            value={d.lastModified}
                            year="numeric"
                            month="short"
                            day="numeric"
                            hour="2-digit"
                            minute="2-digit"
                          />
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {d.id && (
                          <Tooltip title={intl.formatMessage({ id: 'documents.askDocument' })}>
                            <IconButton
                              size="small"
                              onClick={() => setAskTarget(d)}
                              aria-label={intl.formatMessage(
                                { id: 'documents.askDocumentAria' },
                                {
                                  title:
                                    d.title && d.title.length > 0
                                      ? d.title
                                      : intl.formatMessage({ id: 'documents.untitled' }),
                                },
                              )}
                            >
                              <QuestionAnswerOutlined fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </TableContainer>
              {/* A lookup returns one page (the API max) — say so when it's full,
                  or a "complete" -looking result quietly drops the tail. */}
              {lookupActive && typedDocuments.length === PAGE_SIZE && (
                <Typography variant="caption" color="text.secondary">
                  <FormattedMessage id="documents.truncatedNote" values={{ count: PAGE_SIZE }} />
                </Typography>
              )}
            </Stack>
          )}
        </>
      )}

      <FolderEditorDialog
        open={folderDialog.open}
        mode={folderDialog.mode}
        folder={folderDialog.folder}
        folders={folders}
        onClose={() => setFolderDialog((d) => ({ ...d, open: false }))}
      />

      <AddDocumentDialog
        open={addDocOpen}
        folders={folders}
        defaultFolderId={scopedFolderId}
        defaultSchemaId={activeSchema?.id}
        onClose={() => setAddDocOpen(false)}
      />

      {/* Per-row "Ask this document" — interrogate a document straight from the
          listing without first opening its detail page. */}
      <DocumentAskDrawer
        open={askTarget !== null}
        documentId={askTarget?.id ?? ''}
        documentTitle={askTarget?.title}
        onClose={() => setAskTarget(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => {
          setDeleteTarget(null);
          deleteFolderMutation.reset(); // drop a prior failure so reopening starts clean
        }}
        onConfirm={() => deleteTarget?.id && deleteFolderMutation.mutate(deleteTarget.id)}
        pending={deleteFolderMutation.isPending}
        title={<FormattedMessage id="documents.folderDeleteTitle" />}
        body={
          <>
            <FormattedMessage
              id="documents.folderDeleteBody"
              values={{ name: deleteTarget?.name ?? deleteTarget?.id ?? '' }}
            />
            {deleteTargetHasContents && (
              // `component="span"` (+ block display): the dialog wraps `body` in
              // a DialogContentText (<p>), and a <p> can't contain another <p>.
              <Typography
                component="span"
                variant="body2"
                color="warning.main"
                sx={{ display: 'block', mt: 1 }}
              >
                <FormattedMessage id="documents.folderDeleteNonEmpty" />
              </Typography>
            )}
          </>
        }
        confirmLabel={<FormattedMessage id="documents.folderDeleteConfirm" />}
        cancelLabel={<FormattedMessage id="folderEditor.cancel" />}
        error={
          deleteFolderMutation.isError ? (
            <>
              {/* A 400 on folder-delete means the folder isn't empty — say so
                  (a generic "try again" would never succeed); else the default. */}
              <FormattedMessage
                id={
                  statusCodeOf(deleteFolderMutation.error) === 400
                    ? 'documents.folderDeleteNonEmptyError'
                    : 'documents.folderDeleteError'
                }
              />
              <RequestIdCaption error={deleteFolderMutation.error} />
            </>
          ) : undefined
        }
      />
    </Stack>
  );
}
