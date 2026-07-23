// ---------------------------------------------------------------------------
// RecordsPage — the records read explorer (path: `/records`).
//
// The first data-plane read surface (read paths). Records are listed
// per record TYPE (the partner API requires it), so the page is: pick a schema
// (type) → list its records → click through to a record's detail.
//
// Schema-driven columns: when the selected schema describes fields, their
// values render as columns (ordered + labelled via `renderHints`), and the list
// gains client-side sort (per column) + a filter over the schema's `filterable`
// fields. With no schema fields it falls back to the stable id/status/index/
// updated columns. A `displayField` renderHint promotes one field to the linked
// headline column (the raw id rides along as a caption); with no such hint the
// `id` stays the linked column.
//
// Everything is scoped to the active (tenant, context) by the bearer token —
// the queries key on `context` so a context switch refetches cleanly. Renders
// inside the RequireContext gate, so useActiveContextId() is safe here.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import {
  Alert,
  Box,
  Button,
  FormControl,
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
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { LoadingBlock } from '@vectros-ai/react';
import { useQuery } from '@tanstack/react-query';

import { useActiveContextId, useActiveTenantId } from '../../auth';
import { vectrosApiClient } from '../../api/vectrosApi';
import type { RecordResponse } from '../../api/vectrosApi';
import { schemasForSurface } from '../../lib/schemaSurfaces';
import { listAllSchemas } from '../../lib/listAllSchemas';
import { dataQueryKeys } from '../../lib/dataQueryKeys';
import { indexStatusColor, indexStatusLabel, recordStatusLabel } from '../../lib/recordLabels';
import {
  deriveValueColumns,
  filterableFieldIds,
  findDisplayFieldId,
  formatCellValue,
  payloadMatchesQuery,
  sortRecords,
} from '../../lib/recordColumns';
import type { SortDirection } from '../../lib/recordColumns';
import { fieldLabel } from '../../lib/recordForm';
import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { IndexStatusChip } from '../../components/IndexStatusChip';
import { LookupPanel } from '../../components/LookupPanel';
import type { AppliedLookup, LookupFieldDef } from '../../components/LookupPanel';
import { OwnershipScopeFilter, scopeFilterParam } from '../../components/OwnershipScopeFilter';
import { RefreshButton } from '../../components/RefreshButton';

/** Page size for the records list — the API's max (default is 20). */
const RECORDS_PAGE_SIZE = 100;

/** Sentinel sort key for the (non-schema) "Updated" column. */
const UPDATED_SORT_KEY = '__updatedAt__';

/** A record's payload as a plain bag (the SDK types it loosely). */
function payloadOf(record: RecordResponse): Record<string, unknown> | undefined {
  return record.payload as Record<string, unknown> | undefined;
}

export function RecordsPage(): React.JSX.Element {
  const tenant = useActiveTenantId();
  const context = useActiveContextId();
  const intl = useIntl();
  // The selected type lives in the URL (`?type=`) so it survives navigating to
  // the editor / a record detail and back (a fresh mount reads it from the URL
  // instead of resetting to the default).
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedType = searchParams.get('type');
  const [filterQuery, setFilterQuery] = useState('');
  // Ownership-scope filter (`scope=<namespace>:<value>`) — distinct from the
  // content-type filter above. Only applied when it is well-formed.
  const [scopeFilter, setScopeFilter] = useState('');
  const scopeParam = scopeFilterParam(scopeFilter);
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(null);
  // The APPLIED server-side lookup (null = plain list). The in-progress inputs
  // live inside LookupPanel; it delivers a lookup here only on submit, so the
  // query refetches only when the user runs the lookup.
  const [appliedLookup, setAppliedLookup] = useState<AppliedLookup | null>(null);

  const schemasQuery = useQuery({
    queryKey: dataQueryKeys.schemas(tenant, context),
    queryFn: () => listAllSchemas(tenant, context),
  });

  // Schemas that declare a typeName AND bind to the RECORD surface are the
  // selectable types — a document-only schema must not leak into this picker
  // (its records don't exist; every interaction with it would 4xx).
  const schemas = schemasForSurface(schemasQuery.data ?? [], 'record');
  // Effective type: the user's pick, else the first available type.
  const effectiveType = selectedType ?? schemas[0]?.typeName ?? null;
  const activeSchema = schemas.find((s) => s.typeName === effectiveType);
  const schemaFields = activeSchema?.fields ?? [];

  // Headline/displayField promotion: one field becomes the linked primary
  // column (instead of the raw id). Excluded from the value columns so it isn't
  // duplicated. Undefined when the schema flags no displayField → id stays linked.
  const displayFieldId = findDisplayFieldId(schemaFields, activeSchema?.renderHints);
  const displayField = displayFieldId
    ? schemaFields.find((f) => f.fieldId === displayFieldId)
    : undefined;
  const headlineLabel = displayField
    ? fieldLabel(displayField, activeSchema?.renderHints)
    : null;

  // Schema-derived value columns (sans the promoted headline) + filter fields.
  const valueColumns = deriveValueColumns(
    schemaFields,
    activeSchema?.renderHints,
    undefined,
    displayFieldId,
  );
  const filterFieldIds = filterableFieldIds(schemaFields);

  // Lookup fields declared on the active schema; a field's `rangeEnabled` flag
  // decides whether the panel offers range/prefix modes (vs exact-only).
  const lookupDefs: ReadonlyArray<LookupFieldDef> = (activeSchema?.lookupFields ?? [])
    .filter((l): l is typeof l & { fieldName: string } => typeof l.fieldName === 'string')
    .map((l) => ({ fieldName: l.fieldName, rangeEnabled: l.rangeEnabled === true }));

  const recordsQuery = useQuery({
    // The ownership filter applies to the browse (non-lookup) path only, so it's
    // in the key ONLY there — appending it to the lookup key would wastefully
    // refetch identical rows. Prefix-invalidation still matches.
    queryKey: appliedLookup
      ? dataQueryKeys.recordsLookup(tenant, context, effectiveType ?? '', JSON.stringify(appliedLookup))
      : [...dataQueryKeys.records(tenant, context, effectiveType ?? ''), scopeParam ?? 'all'],
    queryFn: async () => {
      const api = vectrosApiClient(tenant, context).records;
      // `{ data, nextCursor }` page envelope → first-page items.
      if (appliedLookup) {
        // POST-body lookup: works for exact/range/prefix uniformly and keeps a
        // sensitive field's value out of the URL query string.
        const modeArgs =
          appliedLookup.mode === 'exact'
            ? { value: appliedLookup.value }
            : appliedLookup.mode === 'range'
              ? { from: appliedLookup.from, to: appliedLookup.to }
              : { prefix: appliedLookup.prefix };
        return (
          await api.lookupRecordsByBody({
            type: effectiveType as string,
            field: appliedLookup.field,
            ...modeArgs,
            order: appliedLookup.order,
            limit: RECORDS_PAGE_SIZE,
          })
        ).data ?? [];
      }
      return (
        await api.listRecords({
          type: effectiveType as string,
          limit: RECORDS_PAGE_SIZE,
          ...(scopeParam ? { scope: scopeParam } : {}),
        })
      ).data ?? [];
    },
    enabled: effectiveType !== null,
  });

  const records: ReadonlyArray<RecordResponse> = useMemo(
    () => recordsQuery.data ?? [],
    [recordsQuery.data],
  );

  // Apply the client-side filter (over filterable fields), then the active sort.
  const displayedRecords = useMemo(() => {
    const filtered =
      filterQuery.trim() === '' || filterFieldIds.length === 0
        ? records
        : records.filter((r) => payloadMatchesQuery(payloadOf(r), filterQuery, filterFieldIds));
    if (!sort) return filtered;
    const accessor =
      sort.key === UPDATED_SORT_KEY
        ? (r: RecordResponse) => r.updatedAt
        : (r: RecordResponse) => payloadOf(r)?.[sort.key];
    return sortRecords(filtered, accessor, sort.direction);
  }, [records, filterQuery, filterFieldIds, sort]);

  const handleTypeChange = (event: SelectChangeEvent): void => {
    const next = new URLSearchParams(searchParams);
    next.set('type', event.target.value);
    // replace (not push) so switching types doesn't stack history entries.
    setSearchParams(next, { replace: true });
    // Columns/filterable/lookup fields differ per type — reset sort, filter, lookup.
    // (LookupPanel's inputs reset via its `key={effectiveType}` remount.)
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

  /** A sortable column header cell. Keyed — callers render these from maps. */
  const sortableHeader = (
    key: string,
    label: React.ReactNode,
    align?: 'right',
  ): React.JSX.Element => (
    <TableCell key={key} align={align} sortDirection={sort?.key === key ? sort.direction : false}>
      <TableSortLabel
        active={sort?.key === key}
        direction={sort?.key === key ? sort.direction : 'asc'}
        onClick={() => toggleSort(key)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  const showFilter = filterFieldIds.length > 0;
  const filteredToEmpty = records.length > 0 && displayedRecords.length === 0;

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
            <FormattedMessage id="records.title" />
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
            <FormattedMessage id="records.subtitle" />
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
          <RefreshButton
            onClick={() => void recordsQuery.refetch()}
            loading={recordsQuery.isFetching}
            label={intl.formatMessage({ id: 'records.refresh' })}
          />
          <Button
            component={RouterLink}
            // Carry the type the user is viewing so the editor opens pre-set to it.
            to={
              effectiveType
                ? `/records/new?type=${encodeURIComponent(effectiveType)}`
                : '/records/new'
            }
            startIcon={<AddIcon />}
            variant="contained"
          >
            <FormattedMessage id="records.newRecord" />
          </Button>
        </Stack>
      </Box>

      {schemasQuery.isPending ? (
        <LoadingBlock label={intl.formatMessage({ id: 'records.loadingSchemas' })} />
      ) : schemasQuery.isError ? (
        <ApiErrorAlert error={schemasQuery.error}>
          <FormattedMessage id="records.schemasError" />
        </ApiErrorAlert>
      ) : schemas.length === 0 ? (
        <Alert severity="info">
          <FormattedMessage id="records.noSchemas" />
        </Alert>
      ) : (
        <>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 240, maxWidth: 360 }}>
              <InputLabel id="records-type-label">
                <FormattedMessage id="records.typeLabel" />
              </InputLabel>
              <Select
                labelId="records-type-label"
                label={intl.formatMessage({ id: 'records.typeLabel' })}
                value={effectiveType ?? ''}
                onChange={handleTypeChange}
              >
                {schemas.map((s) => (
                  <MenuItem key={s.typeName} value={s.typeName}>
                    {s.displayName && s.displayName.length > 0 ? s.displayName : s.typeName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {showFilter && (
              <TextField
                size="small"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder={intl.formatMessage({ id: 'records.filterPlaceholder' })}
                slotProps={{
                  htmlInput: { 'aria-label': intl.formatMessage({ id: 'records.filterAria' }) },
                }}
                sx={{ minWidth: 240, maxWidth: 360 }}
              />
            )}
            {/* Ownership filter applies to the browse path; a server-side lookup
                runs over the whole context and ignores it, so disable it then. */}
            <OwnershipScopeFilter
              value={scopeFilter}
              onChange={setScopeFilter}
              disabled={appliedLookup !== null}
            />
          </Box>

          {/* Server-side lookup — only when the active schema declares lookup
              fields. Exact match always; range (from/to) + prefix on
              range-enabled fields; `order` sets the server's sort direction.
              Keyed on the type so its inputs reset when the type changes. */}
          <LookupPanel
            key={effectiveType ?? ''}
            defs={lookupDefs}
            applied={appliedLookup}
            onApply={setAppliedLookup}
            messagePrefix="records"
            idPrefix="records-lookup"
          />

          {recordsQuery.isPending ? (
            <LoadingBlock label={intl.formatMessage({ id: 'records.loadingRecords' })} />
          ) : recordsQuery.isError ? (
            <ApiErrorAlert error={recordsQuery.error}>
              <FormattedMessage id="records.recordsError" />
            </ApiErrorAlert>
          ) : records.length === 0 && appliedLookup ? (
            <Alert severity="info">
              <FormattedMessage id="records.noLookupMatch" />
            </Alert>
          ) : records.length === 0 ? (
            <Alert
              severity="info"
              action={
                <Button
                  component={RouterLink}
                  to={
                    effectiveType
                      ? `/records/new?type=${encodeURIComponent(effectiveType)}`
                      : '/records/new'
                  }
                  color="inherit"
                  size="small"
                  startIcon={<AddIcon />}
                >
                  <FormattedMessage id="records.newRecord" />
                </Button>
              }
            >
              <FormattedMessage id="records.noRecords" />
            </Alert>
          ) : filteredToEmpty ? (
            <Alert severity="info">
              <FormattedMessage id="records.noFilterMatch" />
            </Alert>
          ) : (
            <Stack spacing={1}>
              <TableContainer component={Paper}>
                <Table size="small" aria-label={intl.formatMessage({ id: 'records.tableLabel' })}>
                  <TableHead>
                    <TableRow>
                      {displayField && headlineLabel ? (
                        sortableHeader(displayField.fieldId, headlineLabel)
                      ) : (
                        <TableCell>
                          <FormattedMessage id="records.colId" />
                        </TableCell>
                      )}
                      {valueColumns.map((col) => sortableHeader(col.fieldId, col.label))}
                      <TableCell>
                        <FormattedMessage id="records.colStatus" />
                      </TableCell>
                      <TableCell>
                        <FormattedMessage id="records.colIndex" />
                      </TableCell>
                      {sortableHeader(
                        UPDATED_SORT_KEY,
                        <FormattedMessage id="records.colUpdated" />,
                      )}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {displayedRecords.map((r) => {
                      const payload = payloadOf(r);
                      // Headline link text: the displayField's value when promoted
                      // and non-blank, else the raw id. When a non-id headline is
                      // shown, the id rides along as a caption so it stays visible.
                      const rawDisplay = displayField ? payload?.[displayField.fieldId] : undefined;
                      const displayText =
                        rawDisplay === undefined || rawDisplay === null || rawDisplay === ''
                          ? undefined
                          : formatCellValue(rawDisplay);
                      const headlineText = displayText ?? r.id;
                      const showIdCaption = displayText !== undefined && r.id !== undefined;
                      return (
                        <TableRow key={r.id} hover>
                          <TableCell>
                            {r.id ? (
                              <>
                                <Link
                                  component={RouterLink}
                                  to={`/records/${encodeURIComponent(r.id)}`}
                                  sx={displayText !== undefined ? undefined : { fontFamily: 'monospace' }}
                                >
                                  {headlineText}
                                </Link>
                                {showIdCaption && (
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ display: 'block', fontFamily: 'monospace' }}
                                  >
                                    {r.id}
                                  </Typography>
                                )}
                              </>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          {valueColumns.map((col) => (
                            <TableCell key={col.fieldId}>
                              {formatCellValue(payload?.[col.fieldId])}
                            </TableCell>
                          ))}
                          <TableCell>{recordStatusLabel(intl, r.status)}</TableCell>
                          <TableCell>
                            {r.indexStatus ? (
                              <IndexStatusChip
                                label={indexStatusLabel(intl, r.indexStatus)}
                                color={indexStatusColor(r.indexStatus)}
                                failureMessage={r.indexFailure?.message}
                              />
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell>
                            {r.updatedAt ? (
                              <FormattedDate
                                value={r.updatedAt}
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
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
              {records.length === RECORDS_PAGE_SIZE && (
                <Typography variant="caption" color="text.secondary">
                  <FormattedMessage
                    id="records.truncatedNote"
                    values={{ count: RECORDS_PAGE_SIZE }}
                  />
                </Typography>
              )}
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}
