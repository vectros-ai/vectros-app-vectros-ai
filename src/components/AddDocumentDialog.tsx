// ---------------------------------------------------------------------------
// AddDocumentDialog — create a document (document writes).
//
// Two modes:
//   - Upload a file: uploadDocument() returns a presigned S3 PUT URL; we PUT the
//     raw bytes straight to it (no Authorization header — the URL is self-
//     authenticating). The document then indexes asynchronously (PENDING_INDEX).
//   - Ingest text: ingestDocument() stores supplied text directly.
//
// Both place the document in the selected folder (or the context's default root)
// and pick an index mode (HYBRID recommended). An optional TYPE binds the
// document to a document-surface schema: its declared fields render as a typed
// metadata form (validated on save, queryable as search filters). An optional
// EXTERNAL ID makes the create idempotent (and is the key for "Replace file"
// later): repeating a create with the same externalId returns the EXISTING
// document — for text ingest the submitted content is then NOT applied unless
// "update if it exists" (the `upsert` flag) is on, so that outcome is surfaced
// loudly rather than closing as if it saved; a re-upload always replaces the
// file and re-indexes. Owns its mutation + documents-query invalidation.
// Scoped to the active (tenant, context) by the bearer token.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { SubmitButton } from '@vectros-ai/react';
import { FormattedMessage, useIntl } from 'react-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveContextId, useActiveTenantId } from '../auth';
import { vectrosApiClient } from '../api/vectrosApi';
import type { FolderResponse } from '../api/vectrosApi';
import { dataQueryKeys } from '../lib/dataQueryKeys';
import { formatBytes } from '../lib/formatBytes';
import { listAllSchemas } from '../lib/listAllSchemas';
import { schemasForSurface } from '../lib/schemaSurfaces';
import {
  coerceFieldValue,
  isReservedPayloadKey,
  validateFields,
  withField,
} from '../lib/recordForm';
import { MAX_UPLOAD_BYTES } from '../lib/uploadLimits';
import { ApiErrorAlert } from './ApiErrorAlert';
import { RecordFormFields } from './RecordFormFields';
import { folderMenuItems } from './folderMenuItems';
import { OwnershipScopeField } from './OwnershipScopeField';
import type { OwnershipScopeSelection } from './OwnershipScopeField';

const NO_FOLDER = '';
const NO_TYPE = '';
const INDEX_MODES = ['HYBRID', 'SEMANTIC', 'TEXT'] as const;
type IndexMode = (typeof INDEX_MODES)[number];

interface AddDocumentDialogProps {
  readonly open: boolean;
  readonly folders: ReadonlyArray<FolderResponse>;
  /** Folder to pre-select as the upload target (the list's current folder). */
  readonly defaultFolderId?: string | undefined;
  /** Document type (schema id) to pre-select — the list's active type view. */
  readonly defaultSchemaId?: string | undefined;
  readonly onClose: () => void;
}

export function AddDocumentDialog({
  open,
  folders,
  defaultFolderId,
  defaultSchemaId,
  onClose,
}: AddDocumentDialogProps): React.JSX.Element {
  const tenant = useActiveTenantId();
  const context = useActiveContextId();
  const intl = useIntl();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<'upload' | 'ingest'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [indexMode, setIndexMode] = useState<IndexMode>('HYBRID');
  // File-upload text-retention choice (upload mode only; fixed at ingest and
  // immutable after). Default true — keep the extracted text retrievable and
  // answerable. Text ingest always retains its body, so this does not apply there.
  const [storeText, setStoreText] = useState(true);
  const [folderId, setFolderId] = useState<string>(NO_FOLDER);
  const [schemaId, setSchemaId] = useState<string>(NO_TYPE);
  // Typed metadata (the document `payload`), edited via the schema-driven form
  // when a type is selected. Reset alongside the type — fields belong to it.
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [externalId, setExternalId] = useState('');
  const [upsert, setUpsert] = useState(false);
  // Ownership scopes for text ingest (the file-upload path inherits identity).
  const [scopeSel, setScopeSel] = useState<OwnershipScopeSelection>({
    scopes: undefined,
    valid: true,
  });
  // Set when a text ingest matched an existing externalId WITHOUT upsert — the
  // submitted content was NOT applied, which must not look like a save.
  const [existingUnchanged, setExistingUnchanged] = useState(false);

  // Document-surface types drive the optional Type picker. Shared query key —
  // cached with every other schema consumer; on failure the picker simply
  // hides (untyped creates keep working).
  const schemasQuery = useQuery({
    queryKey: dataQueryKeys.schemas(tenant, context),
    queryFn: () => listAllSchemas(tenant, context),
  });
  const docTypes = schemasForSurface(schemasQuery.data ?? [], 'document');
  const activeSchema = docTypes.find((s) => s.id !== undefined && s.id === schemaId);
  // Reserved identifier keys (externalId / ownership ids) are top-level
  // document fields, never payload entries — keep them out of the form.
  const schemaFields = (activeSchema?.fields ?? []).filter(
    (f) => !isReservedPayloadKey(f.fieldId),
  );
  const fieldErrors = activeSchema ? validateFields(schemaFields, payload) : {};

  // Reset the form each time the dialog opens, defaulting the target folder to
  // the folder the list is currently viewing (so adding from a folder lands the
  // document there) — falling back to the context root when viewing all.
  useEffect(() => {
    if (!open) return;
    setMode('upload');
    setFile(null);
    setTitle('');
    setText('');
    setIndexMode('HYBRID');
    setStoreText(true);
    setFolderId(defaultFolderId ?? NO_FOLDER);
    // Adding from a by-type view pre-selects that type (still changeable).
    setSchemaId(defaultSchemaId ?? NO_TYPE);
    setPayload({});
    setExternalId('');
    setUpsert(false);
    setExistingUnchanged(false);
  }, [open, defaultFolderId, defaultSchemaId]);

  const mutation = useMutation({
    mutationFn: async (): Promise<{ ingestReturnedExisting: boolean }> => {
      const client = vectrosApiClient(tenant, context);
      const folderPart = folderId === NO_FOLDER ? {} : { folderId };
      const externalIdPart = externalId.trim() === '' ? {} : { externalId: externalId.trim() };
      // Typed create: bind the schema and send the form-authored metadata
      // (validated against the schema server-side).
      const typePart = schemaId === NO_TYPE ? {} : { schemaId };
      const payloadPart =
        schemaId !== NO_TYPE && Object.keys(payload).length > 0 ? { payload } : {};

      if (mode === 'upload') {
        if (!file) throw new Error('no file selected');
        // Backstop the UI guard (canSubmit) so an oversize file can never reach
        // the presigned PUT (which would 200 then fail at index time).
        if (file.size > MAX_UPLOAD_BYTES) {
          throw new Error(intl.formatMessage({ id: 'addDocument.fileTooLarge' }));
        }
        const fileType = file.type || 'application/octet-stream';
        const created = await client.documents.uploadDocument({
          fileName: file.name,
          fileType,
          indexMode,
          storeText,
          ...typePart,
          ...payloadPart,
          ...folderPart,
          ...externalIdPart,
        });
        if (!created.uploadUrl) throw new Error('upload did not return a presigned URL');
        // PUT the raw bytes straight to S3 — the presigned URL is self-
        // authenticating, so NO Authorization header (one would break the
        // signature). Content-Type must match the fileType we declared.
        const put = await fetch(created.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': fileType },
          body: file,
        });
        if (!put.ok) throw new Error(`file upload failed: ${put.status}`);
        // A matched externalId (created:false) still replaced the file and
        // re-indexes — a real write either way, so no special outcome here.
        return { ingestReturnedExisting: false };
      }

      const doc = await client.documents.ingestDocument({
        // `upsert` applies the submitted content to an existing externalId
        // match (0.31 semantics) — without it the match is returned UNCHANGED.
        // Guarded on a non-empty externalId: the switch hides when the id is
        // erased but its state persists, and upsert is meaningless without
        // the identity key it matches on.
        ...(upsert && externalId.trim() !== '' ? { upsert: true } : {}),
        body: {
          title: title.trim(),
          text,
          indexMode,
          ...typePart,
          ...payloadPart,
          ...folderPart,
          ...externalIdPart,
          // Omit `scopes` to inherit the token's full identity; `[]` = private.
          // (Text ingest only — the file-upload path inherits identity.)
          ...(scopeSel.scopes === undefined ? {} : { scopes: scopeSel.scopes }),
        },
      });
      // created:false without upsert = the submitted title/text were NOT
      // applied. Surface it (closing silently would fake a save).
      return { ingestReturnedExisting: doc.created === false && !upsert };
    },
    onSuccess: ({ ingestReturnedExisting }) => {
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.documents(tenant, context) });
      if (ingestReturnedExisting) {
        setExistingUnchanged(true);
        return;
      }
      onClose();
    },
  });

  const fileTooLarge = file !== null && file.size > MAX_UPLOAD_BYTES;
  const canSubmit =
    !mutation.isPending &&
    Object.keys(fieldErrors).length === 0 &&
    (mode === 'upload'
      ? file !== null && !fileTooLarge
      : title.trim() !== '' && text.trim() !== '' && scopeSel.valid);

  return (
    <Dialog open={open} onClose={() => !mutation.isPending && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>
        <FormattedMessage id="addDocument.title" />
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {mutation.isError && (
            <ApiErrorAlert error={mutation.error}>
              <FormattedMessage id="addDocument.error" />
            </ApiErrorAlert>
          )}
          {existingUnchanged && (
            <Alert severity="warning">
              <FormattedMessage id="addDocument.existingUnchanged" />
            </Alert>
          )}

          <ToggleButtonGroup
            value={mode}
            exclusive
            size="small"
            onChange={(_e, next: 'upload' | 'ingest' | null) => next !== null && setMode(next)}
            aria-label={intl.formatMessage({ id: 'addDocument.modeLabel' })}
          >
            <ToggleButton value="upload">
              <FormattedMessage id="addDocument.modeUpload" />
            </ToggleButton>
            <ToggleButton value="ingest">
              <FormattedMessage id="addDocument.modeIngest" />
            </ToggleButton>
          </ToggleButtonGroup>

          {mode === 'upload' ? (
            <Box>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                aria-label={intl.formatMessage({ id: 'addDocument.fileLabel' })}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Button
                variant="outlined"
                startIcon={<UploadFileIcon />}
                onClick={() => fileInputRef.current?.click()}
              >
                <FormattedMessage id={file ? 'addDocument.changeFile' : 'addDocument.chooseFile'} />
              </Button>
              {file ? (
                // Clear, removable confirmation of the chosen file (name + size).
                <Chip
                  label={`${file.name} · ${formatBytes(file.size)}`}
                  onDelete={() => setFile(null)}
                  color={fileTooLarge ? 'error' : 'default'}
                  variant="outlined"
                  sx={{ mt: 1.5, maxWidth: '100%' }}
                />
              ) : (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  <FormattedMessage id="addDocument.noFileChosen" />
                </Typography>
              )}
              {fileTooLarge && (
                <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
                  <FormattedMessage id="addDocument.fileTooLarge" />
                </Typography>
              )}
              {mutation.isPending && (
                <LinearProgress sx={{ mt: 1.5 }} aria-label={intl.formatMessage({ id: 'addDocument.uploading' })} />
              )}
              {/* File-only retention choice — text ingest always keeps its body. */}
              <FormControlLabel
                sx={{ mt: 1.5, display: 'block' }}
                control={
                  <Switch checked={storeText} onChange={(e) => setStoreText(e.target.checked)} />
                }
                label={intl.formatMessage({ id: 'addDocument.storeText' })}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                <FormattedMessage id="addDocument.storeTextHelp" />
              </Typography>
            </Box>
          ) : (
            <>
              <TextField
                label={intl.formatMessage({ id: 'addDocument.titleLabel' })}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                size="small"
              />
              <TextField
                label={intl.formatMessage({ id: 'addDocument.textLabel' })}
                value={text}
                onChange={(e) => setText(e.target.value)}
                required
                multiline
                minRows={6}
                size="small"
              />
            </>
          )}

          {/* Optional document type — binds a document-surface schema; its
              declared fields render as a typed metadata form below. */}
          {docTypes.length > 0 && (
            <FormControl size="small">
              <InputLabel id="add-doc-type-label">
                <FormattedMessage id="addDocument.typeLabel" />
              </InputLabel>
              <Select
                labelId="add-doc-type-label"
                label={intl.formatMessage({ id: 'addDocument.typeLabel' })}
                value={schemaId}
                onChange={(e: SelectChangeEvent) => {
                  setSchemaId(e.target.value);
                  setPayload({}); // metadata fields belong to the selected type
                }}
              >
                <MenuItem value={NO_TYPE}>
                  {intl.formatMessage({ id: 'addDocument.typeNone' })}
                </MenuItem>
                {docTypes.map((s) => (
                  <MenuItem key={s.id} value={s.id ?? ''}>
                    {s.typeName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {activeSchema && schemaFields.length > 0 && (
            <RecordFormFields
              fields={schemaFields}
              value={payload}
              errors={fieldErrors}
              renderHints={activeSchema.renderHints}
              rawOnlyNoteId="documentForm.notEditableHere"
              onChange={(field, input) =>
                setPayload(withField(payload, field.fieldId, coerceFieldValue(field, input)))
              }
            />
          )}

          <FormControl size="small">
            <InputLabel id="add-doc-index-label">
              <FormattedMessage id="addDocument.indexModeLabel" />
            </InputLabel>
            <Select
              labelId="add-doc-index-label"
              label={intl.formatMessage({ id: 'addDocument.indexModeLabel' })}
              value={indexMode}
              onChange={(e: SelectChangeEvent) => setIndexMode(e.target.value as IndexMode)}
            >
              {INDEX_MODES.map((m) => (
                <MenuItem key={m} value={m}>
                  {m}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {folders.length > 0 && (
            <FormControl size="small">
              <InputLabel id="add-doc-folder-label">
                <FormattedMessage id="addDocument.folderLabel" />
              </InputLabel>
              <Select
                labelId="add-doc-folder-label"
                label={intl.formatMessage({ id: 'addDocument.folderLabel' })}
                value={folderId}
                onChange={(e: SelectChangeEvent) => setFolderId(e.target.value)}
              >
                <MenuItem value={NO_FOLDER}>
                  {intl.formatMessage({ id: 'addDocument.folderNone' })}
                </MenuItem>
                {folderMenuItems(folders)}
              </Select>
            </FormControl>
          )}

          {/* External ID — the idempotency / cross-reference / re-upload key. */}
          <TextField
            label={intl.formatMessage({ id: 'addDocument.externalIdLabel' })}
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
            size="small"
            helperText={intl.formatMessage({ id: 'addDocument.externalIdHelp' })}
          />
          {mode === 'ingest' && externalId.trim() !== '' && (
            <FormControlLabel
              control={<Switch checked={upsert} onChange={(e) => setUpsert(e.target.checked)} />}
              label={intl.formatMessage({ id: 'addDocument.upsert' })}
            />
          )}

          {mode === 'ingest' ? (
            <OwnershipScopeField key={open ? 'open' : 'closed'} onChange={setScopeSel} />
          ) : (
            <Typography variant="caption" color="text.secondary">
              <FormattedMessage id="ownershipScope.uploadInheritNote" />
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={mutation.isPending}>
          <FormattedMessage id="addDocument.cancel" />
        </Button>
        <SubmitButton
          variant="contained"
          onClick={() => {
            setExistingUnchanged(false); // a retry starts a fresh outcome
            mutation.mutate();
          }}
          disabled={!canSubmit}
          pending={mutation.isPending}
        >
          <FormattedMessage id={mode === 'upload' ? 'addDocument.upload' : 'addDocument.ingest'} />
        </SubmitButton>
      </DialogActions>
    </Dialog>
  );
}
