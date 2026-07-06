// ---------------------------------------------------------------------------
// SearchPage — unified hybrid search (path: `/search`).
//
// One search box over the active context: a single ranked result set spanning
// BOTH records and documents (the `/v1/search` default). The query exposes the
// useful surface of `/v1/search`:
//   - ranking MODE: Hybrid (lexical + semantic) / Semantic / Keyword;
//   - SCOPE filters: content source (all/documents/records), folder, schema type;
//   - PAGINATION via offset ("Load more");
//   - result META: total count, search time, and a degraded-results warning.
// Each result card leads with the item's title (from `metadata`), a semantic
// similarity indicator, source/folder chips, and a matched-text snippet, and
// links into the matching record/document detail.
//
// We render the plain `contextText`/`chunkText` rather than the highlighted
// `snippet` — the snippet carries markup, and this app ships a strict
// no-untrusted-HTML posture, so we never inject it via dangerouslySetInnerHTML.
//
// Renders inside RequireContext, so useActiveContextId() is safe here.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { LoadingBlock } from '@vectros-ai/react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { useActiveContextId, useActiveTenantId } from '../../auth';
import { vectrosApiClient } from '../../api/vectrosApi';
import type { FolderResponse, SchemaResponse, SearchResultItem } from '../../api/vectrosApi';
import { dataQueryKeys } from '../../lib/dataQueryKeys';
import { drainPages } from '../../lib/drainPages';
import { listAllSchemas } from '../../lib/listAllSchemas';
import { folderMenuItems } from '../../components/folderMenuItems';

/** Result page size — the API caps at 100; 25 is a reasonable page. */
const SEARCH_LIMIT = 25;
/** The API caps `offset` at 200, so paging stops once we'd cross it. */
const MAX_OFFSET = 200;
/** Page size for draining the folder list (the API's max). */
const FOLDER_PAGE_SIZE = 100;

/** Ranking mode (maps to the SDK's `mode`). */
type SearchMode = 'HYBRID' | 'SEMANTIC' | 'TEXT';
/** Content-source scope (maps to the SDK's `contentTypes`). */
type Scope = 'all' | 'documents' | 'records';
/** Sentinel filter values meaning "no filter". */
const ALL_FOLDERS = 'ALL';
const ANY_TYPE = '';

/** SDK `contentTypes` for a scope — undefined ("all") yields unified search. */
function contentTypesFor(scope: Scope): ('documents' | 'records')[] | undefined {
  return scope === 'all' ? undefined : [scope];
}

/** Route to a result's detail page based on its source-type discriminator. */
function hrefFor(result: SearchResultItem): string | null {
  if (!result.documentId) return null;
  const id = encodeURIComponent(result.documentId);
  return result.sourceType === 'GenericRecord' ? `/records/${id}` : `/documents/${id}`;
}

/** A non-empty string at `key` in an item's metadata, else undefined. */
function metaString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = meta?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function SearchPage(): React.JSX.Element {
  const tenant = useActiveTenantId();
  const context = useActiveContextId();
  const intl = useIntl();

  const [queryInput, setQueryInput] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('HYBRID');
  const [scope, setScope] = useState<Scope>('all');
  const [folderFilter, setFolderFilter] = useState<string>(ALL_FOLDERS);
  const [typeFilter, setTypeFilter] = useState<string>(ANY_TYPE);

  // Filter option sources (cached; shared with the records/documents pages).
  const foldersQuery = useQuery({
    queryKey: dataQueryKeys.folders(tenant, context),
    queryFn: () =>
      drainPages<FolderResponse>(
        async (startFrom) =>
          (
            await vectrosApiClient(tenant, context).folders.listFolders(
              startFrom === undefined
                ? { limit: FOLDER_PAGE_SIZE }
                : { startFrom, limit: FOLDER_PAGE_SIZE },
            )
          ).data ?? [],
        (f) => f.id,
        FOLDER_PAGE_SIZE,
      ),
  });
  const folders = foldersQuery.data ?? [];
  const folderNameById = new Map(folders.map((f) => [f.id ?? '', f.name ?? f.id ?? '']));

  const schemasQuery = useQuery({
    queryKey: dataQueryKeys.schemas(tenant, context),
    queryFn: () => listAllSchemas(tenant, context),
  });
  const schemaTypes = (schemasQuery.data ?? [])
    .map((s: SchemaResponse) => s.typeName)
    .filter((t): t is string => typeof t === 'string' && t !== '');

  const folderId = folderFilter === ALL_FOLDERS ? undefined : folderFilter;
  // `typeName` scopes a search to a single schema type across whichever content
  // types are in scope — documents and records alike (SDK 0.30.0). We send it
  // whenever a type is chosen; the source scope then decides whether it narrows
  // both content types ("all") or just the one selected.
  const typeName = typeFilter !== ANY_TYPE ? typeFilter : undefined;
  // Stable serialization of everything that affects the result set.
  const descriptor = JSON.stringify({ mode, scope, folder: folderId ?? null, type: typeName ?? null });

  const searchQuery = useInfiniteQuery({
    queryKey: dataQueryKeys.search(tenant, context, submittedQuery, descriptor),
    queryFn: ({ pageParam }) => {
      const contentTypes = contentTypesFor(scope);
      return vectrosApiClient(tenant, context).search.content({
        query: submittedQuery,
        mode,
        limit: SEARCH_LIMIT,
        offset: pageParam,
        ...(contentTypes ? { contentTypes } : {}),
        ...(folderId ? { folderId } : {}),
        ...(typeName ? { typeName } : {}),
      });
    },
    initialPageParam: 0,
    getNextPageParam: (_lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + (p.results?.length ?? 0), 0);
      const total = allPages[0]?.totalResults ?? loaded;
      if (loaded >= total || loaded > MAX_OFFSET) return undefined;
      return loaded; // the next offset
    },
    enabled: submittedQuery !== '',
  });

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    setSubmittedQuery(queryInput.trim());
  };

  const pages = searchQuery.data?.pages ?? [];
  const results: ReadonlyArray<SearchResultItem> = pages.flatMap((p) => p.results ?? []);
  const totalResults = pages[0]?.totalResults ?? results.length;
  const searchTimeMs = pages[0]?.searchTimeMs;
  const degraded = pages.some((p) => p.degraded === true);

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          <FormattedMessage id="search.title" />
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
          <FormattedMessage id="search.subtitle" />
        </Typography>
      </Box>

      <Stack spacing={2}>
        <Box component="form" onSubmit={handleSubmit}>
          <TextField
            fullWidth
            size="small"
            label={intl.formatMessage({ id: 'search.queryLabel' })}
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      type="submit"
                      edge="end"
                      size="small"
                      aria-label={intl.formatMessage({ id: 'search.submit' })}
                      disabled={queryInput.trim() === ''}
                    >
                      <SearchIcon />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

        {/* Filters — applied live (they're part of the query key), so changing
            one re-runs the search without re-submitting. */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
          <ToggleButtonGroup
            value={mode}
            exclusive
            size="small"
            onChange={(_e, next: SearchMode | null) => next !== null && setMode(next)}
            aria-label={intl.formatMessage({ id: 'search.modeLabel' })}
          >
            <ToggleButton value="HYBRID">
              <FormattedMessage id="search.modeHybrid" />
            </ToggleButton>
            <ToggleButton value="SEMANTIC">
              <FormattedMessage id="search.modeSemantic" />
            </ToggleButton>
            <ToggleButton value="TEXT">
              <FormattedMessage id="search.modeKeyword" />
            </ToggleButton>
          </ToggleButtonGroup>

          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="search-scope-label">
              <FormattedMessage id="search.scopeLabel" />
            </InputLabel>
            <Select
              labelId="search-scope-label"
              label={intl.formatMessage({ id: 'search.scopeLabel' })}
              value={scope}
              onChange={(e: SelectChangeEvent) => setScope(e.target.value as Scope)}
            >
              <MenuItem value="all">{intl.formatMessage({ id: 'search.scopeAll' })}</MenuItem>
              <MenuItem value="records">{intl.formatMessage({ id: 'search.scopeRecords' })}</MenuItem>
              <MenuItem value="documents">
                {intl.formatMessage({ id: 'search.scopeDocuments' })}
              </MenuItem>
            </Select>
          </FormControl>

          {folders.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="search-folder-label">
                <FormattedMessage id="search.folderLabel" />
              </InputLabel>
              <Select
                labelId="search-folder-label"
                label={intl.formatMessage({ id: 'search.folderLabel' })}
                value={folderFilter}
                onChange={(e: SelectChangeEvent) => setFolderFilter(e.target.value)}
              >
                <MenuItem value={ALL_FOLDERS}>
                  {intl.formatMessage({ id: 'search.folderAll' })}
                </MenuItem>
                {folderMenuItems(folders)}
              </Select>
            </FormControl>
          )}

          {schemaTypes.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="search-type-label">
                <FormattedMessage id="search.typeFilterLabel" />
              </InputLabel>
              <Select
                labelId="search-type-label"
                label={intl.formatMessage({ id: 'search.typeFilterLabel' })}
                value={typeFilter}
                onChange={(e: SelectChangeEvent) => setTypeFilter(e.target.value)}
              >
                <MenuItem value={ANY_TYPE}>
                  {intl.formatMessage({ id: 'search.typeFilterAll' })}
                </MenuItem>
                {schemaTypes.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Box>
      </Stack>

      {submittedQuery === '' ? (
        <Alert severity="info">
          <FormattedMessage id="search.prompt" />
        </Alert>
      ) : searchQuery.isPending ? (
        <LoadingBlock label={intl.formatMessage({ id: 'search.loading' })} />
      ) : searchQuery.isError ? (
        <Alert severity="error">
          <FormattedMessage id="search.error" />
        </Alert>
      ) : results.length === 0 ? (
        <Alert severity="info">
          <FormattedMessage id="search.empty" values={{ query: submittedQuery }} />
        </Alert>
      ) : (
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, flexWrap: 'wrap' }}>
            <Typography variant="body2" color="text.secondary">
              <FormattedMessage id="search.resultCount" values={{ count: totalResults }} />
            </Typography>
            {typeof searchTimeMs === 'number' && (
              <Typography variant="caption" color="text.secondary">
                <FormattedMessage id="search.timing" values={{ ms: searchTimeMs }} />
              </Typography>
            )}
          </Box>

          {degraded && (
            <Alert severity="warning" role="alert">
              <FormattedMessage id="search.degraded" />
            </Alert>
          )}

          {results.map((r, index) => (
            <ResultCard key={`${r.documentId ?? 'result'}-${index}`} result={r} folderNameById={folderNameById} />
          ))}

          {searchQuery.hasNextPage && (
            <Button
              variant="outlined"
              onClick={() => void searchQuery.fetchNextPage()}
              disabled={searchQuery.isFetchingNextPage}
              startIcon={
                searchQuery.isFetchingNextPage ? <CircularProgress size={16} color="inherit" /> : undefined
              }
              sx={{ alignSelf: 'center' }}
            >
              <FormattedMessage id="search.loadMore" />
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  );
}

interface ResultCardProps {
  readonly result: SearchResultItem;
  readonly folderNameById: ReadonlyMap<string, string>;
}

function ResultCard({ result, folderNameById }: ResultCardProps): React.JSX.Element {
  const intl = useIntl();
  const isRecord = result.sourceType === 'GenericRecord';
  const href = hrefFor(result);
  const title =
    metaString(result.metadata, 'title') ??
    metaString(result.metadata, 'name') ??
    result.documentId ??
    intl.formatMessage({ id: 'search.untitled' });
  const folderName = folderNameById.get(metaString(result.metadata, 'folderId') ?? '');
  const body = result.contextText ?? result.chunkText ?? result.snippet ?? '';
  // Semantic similarity (0–1) is a meaningful absolute match-quality signal when
  // the vector leg ran (HYBRID / SEMANTIC); omit it for keyword-only searches.
  const similarity =
    typeof result.semanticScore === 'number' && result.semanticScore > 0
      ? Math.round(result.semanticScore * 100)
      : null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, flexWrap: 'wrap' }} useFlexGap>
              <Chip
                size="small"
                color={isRecord ? 'secondary' : 'primary'}
                variant="outlined"
                label={intl.formatMessage({ id: isRecord ? 'search.typeRecord' : 'search.typeDocument' })}
              />
              {folderName && <Chip size="small" variant="outlined" label={folderName} />}
            </Stack>
            {href ? (
              <Link component={RouterLink} to={href} variant="subtitle1" sx={{ fontWeight: 600 }}>
                {title}
              </Link>
            ) : (
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {title}
              </Typography>
            )}
            {result.documentId && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace' }}>
                {result.documentId}
              </Typography>
            )}
          </Box>
          {similarity !== null && (
            <Tooltip title={intl.formatMessage({ id: 'search.similarity' })}>
              <Chip size="small" color="default" label={`${similarity}%`} sx={{ flexShrink: 0 }} />
            </Tooltip>
          )}
        </Stack>

        {body.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {body}
          </Typography>
        )}
        {result.createdAt && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            <FormattedDate value={result.createdAt} year="numeric" month="short" day="numeric" />
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
