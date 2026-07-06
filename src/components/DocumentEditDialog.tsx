// ---------------------------------------------------------------------------
// DocumentEditDialog — edit a document's metadata (document writes).
//
// Edits the title, folder placement, and — for a typed document (bound to a
// document-surface schema) — its typed metadata (`payload`) via the same
// schema-driven form the record editor uses. The payload is sent only when a
// field was actually edited; an untouched form leaves the stored payload
// entirely unchanged. The index mode is fixed at creation (the API ignores it
// on update) and the raw text/file is re-ingested through a separate path, so
// neither is editable here. `folderId` cannot be CLEARED once set (API
// constraint), only changed — so an unset selection leaves it unchanged.
//
// Owns its updateDocument mutation + invalidation (the document detail + the
// list). Optimistic concurrency: the loaded `version` is sent as
// expectedVersion so a concurrent edit is rejected (409) rather than clobbered —
// and a 409 surfaces a reload-or-overwrite choice (mirrors RecordEditorPage)
// instead of a dead-end "try again" that would 409 forever.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import { SubmitButton } from '@vectros-ai/react';
import { FormattedMessage, useIntl } from 'react-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useActiveContextId, useActiveTenantId } from '../auth';
import { vectrosApiClient } from '../api/vectrosApi';
import type { DocumentResponse, FolderResponse, SchemaResponse } from '../api/vectrosApi';
import { dataQueryKeys } from '../lib/dataQueryKeys';
import { isVersionConflict } from '../lib/apiError';
import {
  coerceFieldValue,
  isReservedPayloadKey,
  stripReservedPayloadKeys,
  validateFields,
  withField,
} from '../lib/recordForm';
import { ApiErrorAlert } from './ApiErrorAlert';
import { RecordFormFields } from './RecordFormFields';
import { folderMenuItems } from './folderMenuItems';

const KEEP_FOLDER = '';

interface DocumentEditDialogProps {
  readonly open: boolean;
  readonly document: DocumentResponse;
  readonly folders: ReadonlyArray<FolderResponse>;
  /** The document's bound schema, when typed — drives the metadata form. */
  readonly schema?: SchemaResponse | undefined;
  readonly onClose: () => void;
}

export function DocumentEditDialog({
  open,
  document,
  folders,
  schema,
  onClose,
}: DocumentEditDialogProps): React.JSX.Element {
  const tenant = useActiveTenantId();
  const context = useActiveContextId();
  const intl = useIntl();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [folderId, setFolderId] = useState<string>(KEEP_FOLDER);
  // Typed metadata (the document `payload`). Seeded from the loaded document;
  // sent on save only when a field was edited (`payloadDirty`), so an
  // untouched form can never rewrite — or clobber — the stored payload.
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [payloadDirty, setPayloadDirty] = useState(false);
  const [conflict, setConflict] = useState(false);

  // Reserved identifier keys (externalId / ownership ids) are top-level
  // document fields, never payload entries — keep them out of the form.
  const schemaFields = (schema?.fields ?? []).filter((f) => !isReservedPayloadKey(f.fieldId));
  // Validation informs always, but BLOCKS the save only once the user touched
  // the metadata: a stored payload that predates a schema change (e.g. a field
  // later made required) must not hold the title/folder edit hostage — an
  // untouched form omits the payload from the save entirely.
  const fieldErrors = schema ? validateFields(schemaFields, payload) : {};
  const payloadBlocked = payloadDirty && Object.keys(fieldErrors).length > 0;

  // Reseed when the dialog opens or the loaded version changes (a conflict
  // reload brings in a newer version → reseed to it). Deliberately keyed on
  // id+version, NOT the whole `document` object, so a same-version background
  // refetch can't clobber the user's in-progress edits.
  useEffect(() => {
    if (!open) return;
    setTitle(document.title ?? '');
    setFolderId(document.folderId ?? KEEP_FOLDER);
    setPayload(document.payload ?? {});
    setPayloadDirty(false);
    setConflict(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional id+version keying (see above)
  }, [open, document.id, document.version]);

  const mutation = useMutation({
    mutationFn: (opts: { readonly overwrite: boolean }) =>
      vectrosApiClient(tenant, context).documents.updateDocument({
        id: document.id ?? '',
        body: {
          title: title.trim(),
          // indexMode is required by the request type but ignored on update;
          // echo the document's current mode (same string union as the request).
          indexMode: document.indexMode ?? 'HYBRID',
          // folderId can't be cleared — omit when unset to leave it unchanged.
          ...(folderId === KEEP_FOLDER ? {} : { folderId }),
          // The full edited payload, only when a field was actually touched —
          // omitted, the API preserves the stored payload as-is. Reserved
          // identifier keys are stripped on the way out (they are top-level
          // fields; the write API rejects them inside a payload).
          ...(payloadDirty ? { payload: stripReservedPayloadKeys(payload) } : {}),
          // Drop the version guard on an explicit overwrite (last-write-wins).
          ...(opts.overwrite || document.version === undefined
            ? {}
            : { expectedVersion: document.version }),
        },
      }),
    onSuccess: () => {
      const id = document.id;
      if (id) {
        void queryClient.invalidateQueries({ queryKey: dataQueryKeys.document(tenant, context, id) });
      }
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.documents(tenant, context) });
      onClose();
    },
    onError: (err) => {
      if (isVersionConflict(err)) setConflict(true);
    },
  });

  // Discard local edits and refetch the latest document — the parent owns the
  // document query, so invalidating it reseeds this dialog (the effect above)
  // with the newer version, after which a normal save succeeds.
  const handleReload = (): void => {
    const id = document.id;
    if (id) {
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.document(tenant, context, id) });
    }
    setConflict(false);
    mutation.reset();
  };

  const canSave = title.trim() !== '' && !mutation.isPending && !payloadBlocked;

  return (
    <Dialog open={open} onClose={() => !mutation.isPending && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>
        <FormattedMessage id="documentEdit.title" />
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {conflict ? (
            <Alert
              severity="warning"
              role="alert"
              action={
                <Stack direction="row" spacing={1}>
                  <Button color="inherit" size="small" onClick={handleReload}>
                    <FormattedMessage id="documentEdit.reload" />
                  </Button>
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => mutation.mutate({ overwrite: true })}
                  >
                    <FormattedMessage id="documentEdit.overwrite" />
                  </Button>
                </Stack>
              }
            >
              <AlertTitle>
                <FormattedMessage id="documentEdit.conflictTitle" />
              </AlertTitle>
              <FormattedMessage id="documentEdit.conflictBody" />
            </Alert>
          ) : (
            mutation.isError && (
              <ApiErrorAlert error={mutation.error}>
                <FormattedMessage id="documentEdit.error" />
              </ApiErrorAlert>
            )
          )}
          <TextField
            label={intl.formatMessage({ id: 'documentEdit.titleLabel' })}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            size="small"
          />
          {folders.length > 0 && (
            <FormControl size="small">
              <InputLabel id="doc-edit-folder-label">
                <FormattedMessage id="documentEdit.folderLabel" />
              </InputLabel>
              <Select
                labelId="doc-edit-folder-label"
                label={intl.formatMessage({ id: 'documentEdit.folderLabel' })}
                value={folderId}
                onChange={(e: SelectChangeEvent) => setFolderId(e.target.value)}
              >
                {/* No "clear" option — the API can't unset a folder once set. */}
                {document.folderId === undefined && (
                  <MenuItem value={KEEP_FOLDER}>
                    {intl.formatMessage({ id: 'documentEdit.folderNone' })}
                  </MenuItem>
                )}
                {folderMenuItems(folders)}
              </Select>
            </FormControl>
          )}
          {schema && schemaFields.length > 0 && (
            <RecordFormFields
              fields={schemaFields}
              value={payload}
              errors={fieldErrors}
              renderHints={schema.renderHints}
              rawOnlyNoteId="documentForm.notEditableHere"
              onChange={(field, input) => {
                setPayload(withField(payload, field.fieldId, coerceFieldValue(field, input)));
                setPayloadDirty(true);
              }}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={mutation.isPending}>
          <FormattedMessage id="documentEdit.cancel" />
        </Button>
        <SubmitButton
          variant="contained"
          color="primary"
          onClick={() => mutation.mutate({ overwrite: false })}
          disabled={!canSave}
          pending={mutation.isPending}
        >
          <FormattedMessage id="documentEdit.save" />
        </SubmitButton>
      </DialogActions>
    </Dialog>
  );
}
