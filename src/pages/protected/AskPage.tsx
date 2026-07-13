// ---------------------------------------------------------------------------
// AskPage — `/ai/ask`, the single-shot RAG surface. A query box → one grounded
// answer streamed via
// useInferenceStream, plus a citations rail from the RAG `search_results` event.
// Single-shot by design: each ask replaces the previous answer (RagRequest takes
// a single `query`, no conversation memory).
//
// Citations are NON-LINKED snippets in v1: the search-results payload carries
// only `documentId` with no source-type discriminator, and the corpus mixes
// documents + records, so linking would 404 on record hits. They become
// click-through once the backend emits sourceType + typeName. Records
// still GROUND the answer today — only the links wait.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItem,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import StopIcon from '@mui/icons-material/Stop';
import { FormattedMessage, useIntl } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import { useActiveContextId, useActiveTenantId } from '../../auth';
import { vectrosApiClient } from '../../api/vectrosApi';
import type { Vectros, FolderResponse } from '../../api/vectrosApi';
import { dataQueryKeys } from '../../lib/dataQueryKeys';
import { drainPages } from '../../lib/drainPages';
import { folderMenuItems } from '../../components/folderMenuItems';
import { OwnershipScopeFilter, scopeFilterParam } from '../../components/OwnershipScopeFilter';
import { ModelPicker } from '../../components/ModelPicker';
import { InferenceErrorAlert } from '../../components/InferenceErrorAlert';
import { useInferenceModels } from '../../hooks/useInferenceModels';
import { useInferenceStream } from '../../hooks/useInferenceStream';

/** Folder-filter sentinel meaning "the whole context" (no folder scope). */
const ALL_FOLDERS = 'ALL';
/** RAG content-type scope (maps to RagSearch.contentTypes; 'all' omits it). */
type ContentScope = 'all' | 'documents' | 'records';
/** Folders requested per page (API default is 20); the list is drained to exhaustion. */
const FOLDER_PAGE_SIZE = 100;

/** Best available snippet text for a citation. */
function citationSnippet(c: Vectros.RagSearchResult): string {
  return c.snippet ?? c.chunkText ?? c.contextText ?? '';
}

export function AskPage(): React.JSX.Element {
  const tenant = useActiveTenantId();
  const context = useActiveContextId();
  const intl = useIntl();
  const [query, setQuery] = useState('');
  const [model, setModel] = useState<string | undefined>(undefined);
  const { state, run, cancel, isStreaming } = useInferenceStream();
  const modelsQuery = useInferenceModels();

  // Seed the model from the registry default once it loads (mirrors ChatPage).
  useEffect(() => {
    const def = modelsQuery.data?.defaultModel;
    if (model === undefined && def) setModel(def);
  }, [model, modelsQuery.data]);

  // Retrieval scope: narrow RAG to a folder and/or content type via
  // RagSearch. Default is the whole context (no folderId, all content types) —
  // purely additive. folderId is EXACT-folder (both docs + records); subtree
  // scoping is gated on backend symmetry, so no "include sub-folders" yet.
  const [searchParams] = useSearchParams();
  // Trust a deep-linked folderId as the initial scope; it's validated once
  // folders load by the clamp effect below (a stale/deleted id resets to ALL).
  const [scopeFolderId, setScopeFolderId] = useState<string>(
    () => searchParams.get('folderId') ?? ALL_FOLDERS,
  );
  const [contentScope, setContentScope] = useState<ContentScope>('all');
  // Ownership filter (`scope=<namespace>:<value>`) — the item OWNER, distinct
  // from the folder + content-type retrieval controls. Applied when well-formed.
  const [ownerScope, setOwnerScope] = useState('');

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
          ).data ?? [], // `{ data, nextCursor }` page envelope → items array
        (f) => f.id,
        FOLDER_PAGE_SIZE,
      ),
  });
  const folders = foldersQuery.data ?? [];

  // Clamp a stale deep-linked folderId (e.g. a deleted folder) back to "all"
  // once folders load, so we never scope to a non-existent folder.
  useEffect(() => {
    if (
      scopeFolderId !== ALL_FOLDERS &&
      foldersQuery.data !== undefined &&
      !foldersQuery.data.some((f) => f.id === scopeFolderId)
    ) {
      setScopeFolderId(ALL_FOLDERS);
    }
  }, [foldersQuery.data, scopeFolderId]);

  /** The RagSearch scope object, or undefined when scoping to the whole context. */
  const buildSearch = (): Vectros.RagSearch | undefined => {
    const search: Vectros.RagSearch = {};
    if (scopeFolderId !== ALL_FOLDERS) search.folderId = scopeFolderId;
    if (contentScope !== 'all') search.contentTypes = [contentScope];
    const ownerScopeParam = scopeFilterParam(ownerScope);
    if (ownerScopeParam) search.scope = ownerScopeParam;
    return Object.keys(search).length > 0 ? search : undefined;
  };

  const ask = (): void => {
    const q = query.trim();
    if (q === '' || isStreaming) return;
    const search = buildSearch();
    const request: Vectros.RagRequest = {
      query: q,
      ...(model !== undefined ? { model } : {}),
      ...(search ? { search } : {}),
    };
    run(({ abortSignal }) =>
      vectrosApiClient(tenant, context).inference.ragInference(request, { abortSignal }),
    );
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    // Ignore Enter mid-IME-composition (CJK etc.).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ask();
    }
  };

  const hasResult = isStreaming || state.text.length > 0 || state.status === 'error';
  const citations = state.citations ?? [];

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
        <ModelPicker value={model} onChange={setModel} disabled={isStreaming} />

        {/* Retrieval scope: exact folder + content type, fed to RagSearch. */}
        {folders.length > 0 && (
          <FormControl size="small" sx={{ minWidth: 200 }} disabled={isStreaming}>
            <InputLabel id="ask-folder-label">
              <FormattedMessage id="ai.ask.scopeFolder" />
            </InputLabel>
            <Select
              labelId="ask-folder-label"
              label={intl.formatMessage({ id: 'ai.ask.scopeFolder' })}
              value={folders.some((f) => f.id === scopeFolderId) ? scopeFolderId : ALL_FOLDERS}
              onChange={(e: SelectChangeEvent) => setScopeFolderId(e.target.value)}
            >
              <MenuItem value={ALL_FOLDERS}>
                {intl.formatMessage({ id: 'ai.ask.scopeAllFolders' })}
              </MenuItem>
              {folderMenuItems(folders)}
            </Select>
          </FormControl>
        )}

        <ToggleButtonGroup
          size="small"
          exclusive
          value={contentScope}
          onChange={(_e, next: ContentScope | null) => next !== null && setContentScope(next)}
          aria-label={intl.formatMessage({ id: 'ai.ask.scopeContent' })}
          disabled={isStreaming}
        >
          <ToggleButton value="all">
            <FormattedMessage id="ai.ask.scopeAll" />
          </ToggleButton>
          <ToggleButton value="documents">
            <FormattedMessage id="ai.ask.scopeDocuments" />
          </ToggleButton>
          <ToggleButton value="records">
            <FormattedMessage id="ai.ask.scopeRecords" />
          </ToggleButton>
        </ToggleButtonGroup>

        <OwnershipScopeFilter
          value={ownerScope}
          onChange={setOwnerScope}
          disabled={isStreaming}
        />
      </Box>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
        <TextField
          fullWidth
          multiline
          maxRows={4}
          size="small"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={intl.formatMessage({ id: 'ai.ask.placeholder' })}
          slotProps={{
            htmlInput: { 'aria-label': intl.formatMessage({ id: 'ai.ask.placeholder' }) },
          }}
          disabled={isStreaming}
        />
        {isStreaming ? (
          <IconButton
            color="error"
            onClick={cancel}
            aria-label={intl.formatMessage({ id: 'ai.stop' })}
          >
            <StopIcon />
          </IconButton>
        ) : (
          <Button
            variant="contained"
            onClick={ask}
            disabled={query.trim() === ''}
            startIcon={<SearchIcon />}
          >
            <FormattedMessage id="ai.ask.submit" />
          </Button>
        )}
      </Box>

      {!hasResult ? (
        <Alert severity="info">
          <FormattedMessage id="ai.ask.empty" />
        </Alert>
      ) : state.status === 'error' ? (
        <Box aria-live="polite">
          <Stack spacing={2}>
            {/* Preserve any answer text streamed before the failure. */}
            {state.text.length > 0 && (
              <Card>
                <CardContent>
                  <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
                    <FormattedMessage id="ai.ask.answerTitle" />
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                  >
                    {state.text}
                  </Typography>
                </CardContent>
              </Card>
            )}
            <InferenceErrorAlert error={state.error}>
              <FormattedMessage id="ai.ask.errorTitle" />
            </InferenceErrorAlert>
          </Stack>
        </Box>
      ) : (
        <Box aria-live="polite" aria-busy={isStreaming || undefined}>
        <Card>
          <CardContent>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
              <FormattedMessage id="ai.ask.answerTitle" />
            </Typography>
            {state.text.length > 0 ? (
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {state.text}
              </Typography>
            ) : (
              <Box
                role="status"
                sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}
              >
                <CircularProgress size={16} />
                <Typography variant="body2">
                  <FormattedMessage id="ai.thinking" />
                </Typography>
              </Box>
            )}

            {state.truncation && (
              <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1 }}>
                <FormattedMessage
                  id="ai.ask.truncated"
                  values={{
                    used: state.truncation.resultsUsed,
                    requested: state.truncation.resultsRequested,
                  }}
                />
              </Typography>
            )}

            {/* Sources rail, or a "no sources" note once the answer completes. */}
            {citations.length === 0 && state.status === 'done' ? (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="body2" color="text.secondary">
                  <FormattedMessage id="ai.ask.noCitations" />
                </Typography>
              </>
            ) : citations.length > 0 ? (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  <FormattedMessage id="ai.ask.citationsTitle" />
                </Typography>
                {state.search && (
                  <Typography variant="caption" color="text.secondary">
                    <FormattedMessage
                      id="ai.ask.citationsMeta"
                      values={{ total: state.search.totalResults, ms: state.search.searchTimeMs }}
                    />
                  </Typography>
                )}
                <List dense>
                  {citations.map((c, i) => (
                    <ListItem key={`${c.documentId}-${i}`} alignItems="flex-start" disableGutters>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                          {i + 1}.{' '}
                          {citationSnippet(c) || (
                            <Typography component="span" variant="body2" color="text.secondary">
                              <FormattedMessage id="ai.ask.citationNoPreview" />
                            </Typography>
                          )}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontFamily: 'monospace' }}
                        >
                          {c.documentId} · {c.score.toFixed(2)}
                        </Typography>
                      </Box>
                    </ListItem>
                  ))}
                </List>
                <Typography variant="caption" color="text.secondary">
                  <FormattedMessage id="ai.ask.citationsNote" />
                </Typography>
              </>
            ) : null}
          </CardContent>
        </Card>
        </Box>
      )}
    </Stack>
  );
}
