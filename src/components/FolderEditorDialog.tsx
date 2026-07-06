// ---------------------------------------------------------------------------
// FolderEditorDialog — create / rename a folder (folder writes).
//
// Folder authoring IS in-app (it's document organization, not schema/context
// definition). One dialog, two modes:
//   - create: name (required) + optional description + optional parent folder;
//   - edit:   name + description (parent is fixed — a folder can't be moved via
//             the API, FolderRequest.parentFolderId is ignored on update).
//
// Owns its create/update mutation + query invalidation so the host page only
// toggles `open`. Scoped to the active (tenant, context) by the bearer token.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import {
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
import type { FolderResponse } from '../api/vectrosApi';
import { dataQueryKeys } from '../lib/dataQueryKeys';
import { ApiErrorAlert } from './ApiErrorAlert';
import { folderMenuItems } from './folderMenuItems';

/** Sentinel for the "no parent (root)" option in the parent select. */
const ROOT_PARENT = '';

interface FolderEditorDialogProps {
  readonly open: boolean;
  readonly mode: 'create' | 'edit';
  /** The folder being edited (edit mode only). */
  readonly folder?: FolderResponse | undefined;
  /** All folders in the context — the parent-select options (create mode). */
  readonly folders: ReadonlyArray<FolderResponse>;
  readonly onClose: () => void;
}

export function FolderEditorDialog({
  open,
  mode,
  folder,
  folders,
  onClose,
}: FolderEditorDialogProps): React.JSX.Element {
  const tenant = useActiveTenantId();
  const context = useActiveContextId();
  const intl = useIntl();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentFolderId, setParentFolderId] = useState<string>(ROOT_PARENT);

  // Seed the form whenever the dialog opens (or the target folder changes).
  useEffect(() => {
    if (!open) return;
    setName(folder?.name ?? '');
    setDescription(folder?.description ?? '');
    setParentFolderId(folder?.parentFolderId ?? ROOT_PARENT);
  }, [open, folder]);

  const mutation = useMutation({
    mutationFn: () => {
      const client = vectrosApiClient(tenant, context);
      const trimmedName = name.trim();
      const trimmedDescription = description.trim();
      if (mode === 'create') {
        return client.folders.createFolder({
          body: {
            name: trimmedName,
            ...(trimmedDescription === '' ? {} : { description: trimmedDescription }),
            ...(parentFolderId === ROOT_PARENT ? {} : { parentFolderId }),
          },
        });
      }
      // Edit: parentFolderId is ignored on update (no move), so it's not sent.
      return client.folders.updateFolder({
        id: folder?.id ?? '',
        body: {
          name: trimmedName,
          ...(trimmedDescription === '' ? {} : { description: trimmedDescription }),
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.folders(tenant, context) });
      onClose();
    },
  });

  const canSave = name.trim() !== '' && !mutation.isPending;

  return (
    <Dialog open={open} onClose={() => !mutation.isPending && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>
        <FormattedMessage
          id={mode === 'create' ? 'folderEditor.createTitle' : 'folderEditor.editTitle'}
        />
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {mutation.isError && (
            <ApiErrorAlert error={mutation.error}>
              <FormattedMessage id="folderEditor.error" />
            </ApiErrorAlert>
          )}
          <TextField
            label={intl.formatMessage({ id: 'folderEditor.nameLabel' })}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            size="small"
            slotProps={{ htmlInput: { maxLength: 255 } }}
          />
          <TextField
            label={intl.formatMessage({ id: 'folderEditor.descriptionLabel' })}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={2}
            size="small"
          />
          {mode === 'create' && folders.length > 0 && (
            <FormControl size="small">
              <InputLabel id="folder-parent-label">
                <FormattedMessage id="folderEditor.parentLabel" />
              </InputLabel>
              <Select
                labelId="folder-parent-label"
                label={intl.formatMessage({ id: 'folderEditor.parentLabel' })}
                value={parentFolderId}
                onChange={(e: SelectChangeEvent) => setParentFolderId(e.target.value)}
              >
                <MenuItem value={ROOT_PARENT}>
                  {intl.formatMessage({ id: 'folderEditor.parentNone' })}
                </MenuItem>
                {folderMenuItems(folders)}
              </Select>
            </FormControl>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={mutation.isPending}>
          <FormattedMessage id="folderEditor.cancel" />
        </Button>
        <SubmitButton
          variant="contained"
          onClick={() => mutation.mutate()}
          disabled={!canSave}
          pending={mutation.isPending}
        >
          <FormattedMessage id={mode === 'create' ? 'folderEditor.create' : 'folderEditor.save'} />
        </SubmitButton>
      </DialogActions>
    </Dialog>
  );
}
