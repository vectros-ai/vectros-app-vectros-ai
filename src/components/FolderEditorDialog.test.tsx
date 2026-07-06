// ---------------------------------------------------------------------------
// FolderEditorDialog tests — the create payload shaping (optional description +
// parent) and EDIT mode (parent deliberately omitted — no move via the API),
// both previously untested.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CurrentTenantProvider } from '@vectros-ai/react';
import type { TenantMembership } from '@vectros-ai/react';

import { FolderEditorDialog } from './FolderEditorDialog';
import { CurrentContextProvider } from '../auth/CurrentContextProvider';
import { TestProviders } from '../test/TestProviders';
import type { FolderResponse } from '../api/vectrosApi';

vi.mock('../api/vectrosApi', () => ({ vectrosApiClient: vi.fn() }));
import { vectrosApiClient } from '../api/vectrosApi';

const mockedClient = vi.mocked(vectrosApiClient);
const TENANT = 'tnt_0001';
const OWNER: TenantMembership = {
  tenantId: TENANT,
  tenantName: 'Test Org',
  tenantKind: 'test',
  role: 'OWNER',
  status: 'ACTIVE',
  partnerId: 'ptr_0001',
};

function stub(folders: Record<string, unknown>): void {
  mockedClient.mockReturnValue({ folders } as never);
}

function renderDialog(opts: {
  mode: 'create' | 'edit';
  folder?: FolderResponse;
  folders?: ReadonlyArray<FolderResponse>;
}): { onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn();
  render(
    <TestProviders>
      <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
        <CurrentContextProvider
          initialContexts={[{ contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' }]}
          initialContext="default"
        >
          <FolderEditorDialog
            open
            mode={opts.mode}
            folder={opts.folder}
            folders={opts.folders ?? []}
            onClose={onClose}
          />
        </CurrentContextProvider>
      </CurrentTenantProvider>
    </TestProviders>,
  );
  return { onClose };
}

describe('FolderEditorDialog — create', () => {
  beforeEach(() => mockedClient.mockReset());

  it('creates with just a name (optional fields omitted)', async () => {
    const user = userEvent.setup();
    const createFolder = vi.fn().mockResolvedValue({ id: 'f_new' });
    stub({ createFolder });

    const { onClose } = renderDialog({ mode: 'create' });
    await user.type(screen.getByRole('textbox', { name: 'Folder name' }), 'Reports');
    await user.click(screen.getByRole('button', { name: 'Create folder' }));

    // The request body nests under `body` (SDK 0.31 un-inlined it when `?upsert` was added).
    await vi.waitFor(() => expect(createFolder).toHaveBeenCalledWith({ body: { name: 'Reports' } }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('includes description and parent folder when provided', async () => {
    const user = userEvent.setup();
    const createFolder = vi.fn().mockResolvedValue({ id: 'f_new' });
    stub({ createFolder });
    const folders: FolderResponse[] = [{ id: 'p1', name: 'Parent' } as FolderResponse];

    renderDialog({ mode: 'create', folders });
    await user.type(screen.getByRole('textbox', { name: 'Folder name' }), 'Child');
    await user.type(screen.getByRole('textbox', { name: /description/i }), 'A child folder');
    await user.click(screen.getByRole('combobox', { name: /parent folder/i }));
    await user.click(await screen.findByRole('option', { name: 'Parent' }));
    await user.click(screen.getByRole('button', { name: 'Create folder' }));

    await vi.waitFor(() =>
      expect(createFolder).toHaveBeenCalledWith({
        body: {
          name: 'Child',
          description: 'A child folder',
          parentFolderId: 'p1',
        },
      }),
    );
  });

  it('surfaces an error and stays open on failure', async () => {
    const user = userEvent.setup();
    stub({ createFolder: vi.fn().mockRejectedValue(new Error('boom')) });
    const { onClose } = renderDialog({ mode: 'create' });

    await user.type(screen.getByRole('textbox', { name: 'Folder name' }), 'X');
    await user.click(screen.getByRole('button', { name: 'Create folder' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t save this folder/i);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('FolderEditorDialog — edit', () => {
  beforeEach(() => mockedClient.mockReset());

  it('seeds from the folder and updates name + description WITHOUT parent (no move)', async () => {
    const user = userEvent.setup();
    const updateFolder = vi.fn().mockResolvedValue({ id: 'f1' });
    stub({ updateFolder });
    const folder: FolderResponse = {
      id: 'f1',
      name: 'Old Name',
      description: 'Old desc',
      parentFolderId: 'p1',
    } as FolderResponse;

    renderDialog({ mode: 'edit', folder, folders: [folder] });

    const nameField = screen.getByRole('textbox', { name: 'Folder name' });
    expect(nameField).toHaveValue('Old Name');
    await user.clear(nameField);
    await user.type(nameField, 'New Name');
    // Edit mode shows no parent picker (a folder can't be moved via the API).
    expect(screen.queryByRole('combobox', { name: /parent folder/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await vi.waitFor(() =>
      expect(updateFolder).toHaveBeenCalledWith({
        id: 'f1',
        body: { name: 'New Name', description: 'Old desc' },
      }),
    );
  });

  it('keeps the title bar labeled for edit mode', () => {
    stub({ updateFolder: vi.fn() });
    renderDialog({
      mode: 'edit',
      folder: { id: 'f1', name: 'F' } as FolderResponse,
      folders: [],
    });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Edit folder')).toBeInTheDocument();
  });
});
