// ---------------------------------------------------------------------------
// DocumentEditDialog tests — the optimistic-concurrency (409) recovery and the
// folder-change branches that were previously untested. The 409 path is the
// reason this dialog was hardened: it must offer overwrite/reload, not a
// dead-end retry.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CurrentTenantProvider } from '@vectros-ai/react';
import type { TenantMembership } from '@vectros-ai/react';

import { DocumentEditDialog } from './DocumentEditDialog';
import { CurrentContextProvider } from '../auth/CurrentContextProvider';
import { TestProviders } from '../test/TestProviders';
import type { DocumentResponse, FolderResponse, SchemaResponse } from '../api/vectrosApi';

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

function stub(updateDocument: ReturnType<typeof vi.fn>): void {
  mockedClient.mockReturnValue({ documents: { updateDocument } } as never);
}

function renderDialog(opts: {
  document: DocumentResponse;
  folders?: ReadonlyArray<FolderResponse>;
  schema?: SchemaResponse;
}): { onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn();
  render(
    <TestProviders>
      <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
        <CurrentContextProvider
          initialContexts={[{ contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' }]}
          initialContext="default"
        >
          <DocumentEditDialog
            open
            document={opts.document}
            schema={opts.schema}
            folders={opts.folders ?? []}
            onClose={onClose}
          />
        </CurrentContextProvider>
      </CurrentTenantProvider>
    </TestProviders>,
  );
  return { onClose };
}

const DOC: DocumentResponse = {
  id: 'doc_1',
  title: 'Old',
  indexMode: 'HYBRID',
  version: 3,
} as DocumentResponse;

describe('DocumentEditDialog — version conflict (409)', () => {
  beforeEach(() => mockedClient.mockReset());

  it('offers overwrite/reload on a 409 and overwrite resends WITHOUT expectedVersion', async () => {
    const user = userEvent.setup();
    const updateDocument = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 409 })
      .mockResolvedValueOnce({ id: 'doc_1' });
    stub(updateDocument);

    const { onClose } = renderDialog({ document: DOC });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    // The first save sent the version guard…
    await vi.waitFor(() =>
      expect(updateDocument).toHaveBeenNthCalledWith(1, {
        id: 'doc_1',
        body: { title: 'Old', indexMode: 'HYBRID', expectedVersion: 3 },
      }),
    );
    // …and the conflict affordance appears (not a generic dead-end error).
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/changed since you opened it/i);

    await user.click(within(alert).getByRole('button', { name: /overwrite anyway/i }));
    await vi.waitFor(() =>
      expect(updateDocument).toHaveBeenNthCalledWith(2, {
        id: 'doc_1',
        body: { title: 'Old', indexMode: 'HYBRID' }, // no expectedVersion
      }),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('clears the conflict when the user chooses discard & reload', async () => {
    const user = userEvent.setup();
    stub(vi.fn().mockRejectedValue({ statusCode: 409 }));

    renderDialog({ document: DOC });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const alert = await screen.findByRole('alert');
    await user.click(within(alert).getByRole('button', { name: /discard & reload/i }));
    await vi.waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('shows the generic error (not the conflict UI) for a non-409 failure', async () => {
    const user = userEvent.setup();
    stub(vi.fn().mockRejectedValue({ statusCode: 500 }));
    renderDialog({ document: DOC });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t save this document/i);
    expect(screen.queryByText(/changed since you opened it/i)).not.toBeInTheDocument();
  });
});

describe('DocumentEditDialog — folder placement', () => {
  beforeEach(() => mockedClient.mockReset());

  it('includes the chosen folderId in the update', async () => {
    const user = userEvent.setup();
    const updateDocument = vi.fn().mockResolvedValue({ id: 'doc_1' });
    stub(updateDocument);
    const folders: FolderResponse[] = [{ id: 'f1', name: 'Folder One' } as FolderResponse];

    renderDialog({ document: { ...DOC, folderId: undefined } as DocumentResponse, folders });
    await user.click(screen.getByRole('combobox', { name: 'Folder' }));
    await user.click(await screen.findByRole('option', { name: 'Folder One' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await vi.waitFor(() =>
      expect(updateDocument).toHaveBeenCalledWith({
        id: 'doc_1',
        body: { title: 'Old', indexMode: 'HYBRID', folderId: 'f1', expectedVersion: 3 },
      }),
    );
  });

  it('omits folderId when the document has none and the selection is left unset', async () => {
    const user = userEvent.setup();
    const updateDocument = vi.fn().mockResolvedValue({ id: 'doc_1' });
    stub(updateDocument);

    // No folder + no folders to pick → the folderId sentinel is omitted entirely
    // (the API can't unset a folder, so an unset selection means "leave it").
    renderDialog({ document: { ...DOC, folderId: undefined } as DocumentResponse });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await vi.waitFor(() =>
      expect(updateDocument).toHaveBeenCalledWith({
        id: 'doc_1',
        body: { title: 'Old', indexMode: 'HYBRID', expectedVersion: 3 },
      }),
    );
  });
});

describe('DocumentEditDialog — reseed is keyed on (id, version)', () => {
  beforeEach(() => mockedClient.mockReset());

  /** The provider tree, re-renderable with a fresh `document` prop. */
  function tree(document: DocumentResponse): React.JSX.Element {
    return (
      <TestProviders>
        <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
          <CurrentContextProvider
            initialContexts={[{ contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' }]}
            initialContext="default"
          >
            <DocumentEditDialog open document={document} folders={[]} onClose={vi.fn()} />
          </CurrentContextProvider>
        </CurrentTenantProvider>
      </TestProviders>
    );
  }

  it('does NOT clobber in-progress edits on a same-version background refetch', async () => {
    const user = userEvent.setup();
    stub(vi.fn());
    const { rerender } = render(tree({ ...DOC, version: 3 } as DocumentResponse));

    const titleField = screen.getByRole('textbox', { name: 'Title' });
    await user.clear(titleField);
    await user.type(titleField, 'My edit');

    // A background refetch returns the SAME version (no real change) but a
    // different title — the edit must survive (the bug the re-key fixes).
    rerender(tree({ ...DOC, version: 3, title: 'Server changed' } as DocumentResponse));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('My edit');
  });

  it('reseeds the form when the version bumps (e.g. after a conflict reload)', async () => {
    const user = userEvent.setup();
    stub(vi.fn());
    const { rerender } = render(tree({ ...DOC, version: 3 } as DocumentResponse));

    const titleField = screen.getByRole('textbox', { name: 'Title' });
    await user.clear(titleField);
    await user.type(titleField, 'My edit');

    // A reload brings in a newer version → the form reseeds to the latest.
    rerender(tree({ ...DOC, version: 4, title: 'Server changed' } as DocumentResponse));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Server changed');
  });
});

describe('DocumentEditDialog — typed metadata (payload) editing', () => {
  beforeEach(() => mockedClient.mockReset());

  const CONTRACT_SCHEMA = {
    id: 'sch_contract',
    typeName: 'contract',
    allowedSurfaces: ['document'],
    fields: [{ fieldId: 'category', fieldType: 'string' }],
  } as unknown as SchemaResponse;

  const TYPED_DOC = {
    ...DOC,
    schemaId: 'sch_contract',
    payload: { category: 'nda', freeform: 'kept' },
  } as DocumentResponse;

  it('seeds the form from the stored payload and sends the edited payload on save', async () => {
    const user = userEvent.setup();
    const updateDocument = vi.fn().mockResolvedValue({ id: 'doc_1' });
    stub(updateDocument);

    renderDialog({ document: TYPED_DOC, schema: CONTRACT_SCHEMA });

    const field = screen.getByRole('textbox', { name: 'category' });
    expect(field).toHaveValue('nda');
    await user.clear(field);
    await user.type(field, 'msa');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    // The full edited payload rides the update — including keys the schema
    // does not declare (they must never be silently dropped).
    await vi.waitFor(() =>
      expect(updateDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ payload: { category: 'msa', freeform: 'kept' } }),
        }),
      ),
    );
  });

  it('omits the payload entirely when no metadata field was touched', async () => {
    const user = userEvent.setup();
    const updateDocument = vi.fn().mockResolvedValue({ id: 'doc_1' });
    stub(updateDocument);

    renderDialog({ document: TYPED_DOC, schema: CONTRACT_SCHEMA });

    const titleField = screen.getByRole('textbox', { name: 'Title' });
    await user.clear(titleField);
    await user.type(titleField, 'Renamed only');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await vi.waitFor(() => expect(updateDocument).toHaveBeenCalled());
    const body = (updateDocument.mock.calls[0]?.[0] as { body: Record<string, unknown> }).body;
    expect(body).not.toHaveProperty('payload');
    expect(body.title).toBe('Renamed only');
  });

  it('renders no metadata form for an untyped document', () => {
    stub(vi.fn());
    renderDialog({ document: DOC });
    expect(screen.queryByRole('textbox', { name: 'category' })).not.toBeInTheDocument();
  });

  it('does not hold a title-only save hostage to a stored payload that is invalid under the CURRENT schema', async () => {
    const user = userEvent.setup();
    const updateDocument = vi.fn().mockResolvedValue({ id: 'doc_1' });
    stub(updateDocument);

    // The type gained a required field AFTER this document was created: the
    // seeded (untouched) form shows the error, but must not gate the save —
    // an untouched form omits the payload from the update entirely.
    const strictSchema = {
      ...CONTRACT_SCHEMA,
      fields: [{ fieldId: 'category', fieldType: 'string', required: true }],
    } as unknown as SchemaResponse;
    renderDialog({
      document: { ...DOC, schemaId: 'sch_contract', payload: {} } as DocumentResponse,
      schema: strictSchema,
    });

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    const titleField = screen.getByRole('textbox', { name: 'Title' });
    await user.clear(titleField);
    await user.type(titleField, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await vi.waitFor(() => expect(updateDocument).toHaveBeenCalled());
    const body = (updateDocument.mock.calls[0]?.[0] as { body: Record<string, unknown> }).body;
    expect(body).not.toHaveProperty('payload');
    expect(body.title).toBe('Renamed');
  });
});
