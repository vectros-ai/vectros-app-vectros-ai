// ---------------------------------------------------------------------------
// DocumentDetailPage tests — metadata + extracted text, with the SDK mocked.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { CurrentTenantProvider } from '@vectros-ai/react';
import type { TenantMembership } from '@vectros-ai/react';

import { DocumentDetailPage } from './DocumentDetailPage';
import { CurrentContextProvider } from '../../auth/CurrentContextProvider';
import { TestProviders } from '../../test/TestProviders';
import { pageOf } from '../../test/pageOf';

vi.mock('../../api/vectrosApi', () => ({ vectrosApiClient: vi.fn() }));
import { vectrosApiClient } from '../../api/vectrosApi';

const mockedClient = vi.mocked(vectrosApiClient);
const TENANT = 'tnt_0001';

/** Surfaces the router location so navigation targets can be asserted. */
function LocationProbe(): React.JSX.Element {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

const OWNER: TenantMembership = {
  tenantId: TENANT,
  tenantName: 'Test Org',
  tenantKind: 'test',
  role: 'OWNER',
  status: 'ACTIVE',
  partnerId: 'ptr_0001',
};

function stub(opts: {
  getDocument: (req: { id: string }) => Promise<unknown>;
  getDocumentText?: (req: { id: string }) => Promise<unknown>;
  getDocumentDownloadUrl?: (req: { id: string }) => Promise<unknown>;
  updateDocument?: (req: unknown) => Promise<unknown>;
  patchDocument?: (req: unknown) => Promise<unknown>;
  uploadDocument?: (req: unknown) => Promise<unknown>;
  deleteDocument?: (req: { id: string }) => Promise<void>;
  getDocumentVersions?: (req: { id: string }) => Promise<unknown>;
  folders?: () => Promise<unknown>;
  schemas?: () => Promise<unknown>;
}): void {
  mockedClient.mockReturnValue({
    documents: {
      getDocument: opts.getDocument,
      getDocumentText: opts.getDocumentText ?? vi.fn().mockResolvedValue({ text: '' }),
      getDocumentDownloadUrl: opts.getDocumentDownloadUrl ?? vi.fn(),
      updateDocument: opts.updateDocument ?? vi.fn().mockResolvedValue({ id: 'doc_1' }),
      patchDocument: opts.patchDocument ?? vi.fn().mockResolvedValue({ id: 'doc_1' }),
      uploadDocument:
        opts.uploadDocument ??
        vi.fn().mockResolvedValue({ id: 'doc_1', uploadUrl: 'https://s3.example/put' }),
      deleteDocument: opts.deleteDocument ?? vi.fn().mockResolvedValue(undefined),
      getDocumentVersions: opts.getDocumentVersions ?? vi.fn().mockResolvedValue(pageOf([])),
    },
    folders: { listFolders: opts.folders ?? vi.fn().mockResolvedValue(pageOf([])) },
    schemas: { listSchemas: opts.schemas ?? vi.fn().mockResolvedValue(pageOf([])) },
    // The "Ask this document" drawer mounts a ModelPicker (→ listInferenceModels)
    // + documentAsk; stub them so opening the drawer doesn't error.
    inference: {
      listInferenceModels: vi.fn().mockResolvedValue({ defaultModel: 'haiku', models: [] }),
      documentAsk: vi.fn(),
    },
  } as never);
}

function renderDetail(): void {
  render(
    <TestProviders initialEntries={['/documents/doc_1']}>
      <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
        <CurrentContextProvider
          initialContexts={[{ contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' }]}
          initialContext="default"
        >
          <Routes>
            <Route path="/documents/:documentId" element={<DocumentDetailPage />} />
            <Route path="/documents" element={<div>documents list</div>} />
          </Routes>
          <LocationProbe />
        </CurrentContextProvider>
      </CurrentTenantProvider>
    </TestProviders>,
  );
}

describe('DocumentDetailPage', () => {
  beforeEach(() => mockedClient.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it('surfaces a failed folder drain rather than offering an empty folder picker', async () => {
    // The drain feeds the edit dialog's picker. An empty list there reads as
    // "no folders exist" and invites moving the document out of the folder it
    // is actually in.
    stub({
      getDocument: vi.fn().mockResolvedValue({
        id: 'doc_1',
        title: 'Q1 Report',
        status: 'ACTIVE',
        indexStatus: 'INDEXED',
        version: 1,
      }),
      folders: vi.fn().mockRejectedValue(new Error('400 invalid_cursor')),
    });

    renderDetail();

    expect(
      await screen.findByText(/couldn't load this context's folders/i),
    ).toBeInTheDocument();
  });

  it('renders metadata, a download action, and the extracted text', async () => {
    const getDocumentText = vi.fn().mockResolvedValue({ id: 'doc_1', text: 'Hello world' });
    stub({
      getDocument: vi.fn().mockResolvedValue({
        id: 'doc_1',
        title: 'Q1 Report',
        status: 'ACTIVE',
        indexStatus: 'INDEXED',
        indexMode: 'HYBRID',
        storeText: true,
        folderId: 'f1',
        fileType: 'application/pdf',
        fileSize: 2048,
        version: 1,
      }),
      getDocumentText,
    });

    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Q1 Report' })).toBeInTheDocument();
    // Lifecycle status + the processing chip render side by side.
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Indexed')).toBeInTheDocument();
    expect(screen.getByText('HYBRID')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download original/i })).toBeInTheDocument();
    expect(await screen.findByText('Hello world')).toBeInTheDocument();
    expect(getDocumentText).toHaveBeenCalled();
  });

  it('archives via the confirm dialog, sending ONLY the status in the patch', async () => {
    const user = userEvent.setup();
    const patchDocument = vi.fn().mockResolvedValue({ id: 'doc_1', status: 'ARCHIVED' });
    stub({
      getDocument: vi
        .fn()
        .mockResolvedValue({ id: 'doc_1', title: 'Q1 Report', status: 'ACTIVE', storeText: false }),
      patchDocument,
    });

    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    // The dialog says what archiving means before anything happens.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/pulled from search/i);
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    // Merge-patch: only `status` — no title carry-forward.
    await vi.waitFor(() =>
      expect(patchDocument).toHaveBeenCalledWith({ id: 'doc_1', body: { status: 'ARCHIVED' } }),
    );
  });

  it('shows the archived banner and restores with one click when archived', async () => {
    const user = userEvent.setup();
    const patchDocument = vi.fn().mockResolvedValue({ id: 'doc_1', status: 'ACTIVE' });
    stub({
      getDocument: vi
        .fn()
        .mockResolvedValue({ id: 'doc_1', title: 'Q1 Report', status: 'ARCHIVED', storeText: false }),
      patchDocument,
    });

    renderDetail();

    // The archived state is explained, and Archive is replaced by Restore.
    expect(await screen.findByText(/excluded from search and AI recall/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restore' }));
    await vi.waitFor(() =>
      expect(patchDocument).toHaveBeenCalledWith({ id: 'doc_1', body: { status: 'ACTIVE' } }),
    );
  });

  it('replaces the file via a re-upload keyed on the document externalId', async () => {
    const user = userEvent.setup();
    const uploadDocument = vi
      .fn()
      .mockResolvedValue({ id: 'doc_1', uploadUrl: 'https://s3.example/re-put' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    stub({
      getDocument: vi.fn().mockResolvedValue({
        id: 'doc_1',
        title: 'Q1 Report',
        status: 'ACTIVE',
        externalId: 'q1-report',
        fileType: 'application/pdf',
        storeText: false,
      }),
      uploadDocument,
    });

    renderDetail();

    const file = new File(['new bytes'], 'q1-v2.pdf', { type: 'application/pdf' });
    await screen.findByRole('button', { name: 'Replace file' });
    await user.upload(screen.getByLabelText('Replacement file'), file);

    // Re-initiating the upload with the SAME externalId targets the existing
    // document; the new bytes then re-extract + re-index it.
    await vi.waitFor(() =>
      expect(uploadDocument).toHaveBeenCalledWith({
        fileName: 'q1-v2.pdf',
        fileType: 'application/pdf',
        externalId: 'q1-report',
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://s3.example/re-put',
      expect.objectContaining({ method: 'PUT', body: file }),
    );
    // The response names no required header, so none beyond Content-Type is sent.
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ 'Content-Type': 'application/pdf' });
    expect(await screen.findByText(/re-indexing run in the background/i)).toBeInTheDocument();
  });

  it('sends the header the re-upload response requires on the replacement PUT', async () => {
    const user = userEvent.setup();
    const uploadDocument = vi.fn().mockResolvedValue({
      id: 'doc_1',
      uploadUrl: 'https://s3.example/re-put',
      requiredHeaderName: 'If-None-Match',
      requiredHeaderValue: '*',
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    stub({
      getDocument: vi.fn().mockResolvedValue({
        id: 'doc_1',
        title: 'Q1 Report',
        status: 'ACTIVE',
        externalId: 'q1-report',
        fileType: 'application/pdf',
        storeText: false,
      }),
      uploadDocument,
    });

    renderDetail();

    const file = new File(['new bytes'], 'q1-v2.pdf', { type: 'application/pdf' });
    await screen.findByRole('button', { name: 'Replace file' });
    await user.upload(screen.getByLabelText('Replacement file'), file);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      'Content-Type': 'application/pdf',
      'If-None-Match': '*',
    });
    expect(await screen.findByText(/re-indexing run in the background/i)).toBeInTheDocument();
  });

  it('re-sends the schemaId when replacing a TYPED document (type-scoped identity)', async () => {
    const user = userEvent.setup();
    const uploadDocument = vi
      .fn()
      .mockResolvedValue({ id: 'doc_1', uploadUrl: 'https://s3.example/re-put' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    stub({
      getDocument: vi.fn().mockResolvedValue({
        id: 'doc_1',
        title: 'Contract 7',
        status: 'ACTIVE',
        externalId: 'contract-7',
        schemaId: 'sch_contract',
        fileType: 'application/pdf',
        storeText: false,
      }),
      uploadDocument,
      schemas: vi.fn().mockResolvedValue(
        pageOf([{ id: 'sch_contract', typeName: 'contract', allowedSurfaces: ['document'], fields: [] }]),
      ),
    });

    renderDetail();

    const file = new File(['new bytes'], 'contract-v2.pdf', { type: 'application/pdf' });
    await screen.findByRole('button', { name: 'Replace file' });
    await user.upload(screen.getByLabelText('Replacement file'), file);

    // A typed document's externalId lives in its type's namespace — the
    // re-upload must carry the same schemaId to target the SAME document.
    await vi.waitFor(() =>
      expect(uploadDocument).toHaveBeenCalledWith({
        fileName: 'contract-v2.pdf',
        fileType: 'application/pdf',
        externalId: 'contract-7',
        schemaId: 'sch_contract',
      }),
    );
  });

  it('deletes the stray document when a replace MISSED the externalId and minted a new one', async () => {
    const user = userEvent.setup();
    // The lookup missed — the document was deleted elsewhere, or its type moved —
    // so the platform created a NEW document (`created: true`) instead of
    // re-issuing a URL to this one. A failed PUT then strands that new document.
    const uploadDocument = vi
      .fn()
      .mockResolvedValue({ id: 'doc_stray', created: true, uploadUrl: 'https://s3.example/put' });
    const deleteDocument = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    stub({
      getDocument: vi.fn().mockResolvedValue({
        id: 'doc_1',
        title: 'contract.pdf',
        status: 'ACTIVE',
        externalId: 'contract-7',
        fileType: 'application/pdf',
        storeText: false,
      }),
      uploadDocument,
      deleteDocument,
    });

    renderDetail();
    const file = new File(['new bytes'], 'contract-v2.pdf', { type: 'application/pdf' });
    await screen.findByRole('button', { name: 'Replace file' });
    await user.upload(screen.getByLabelText('Replacement file'), file);

    await vi.waitFor(() => expect(deleteDocument).toHaveBeenCalledWith({ id: 'doc_stray' }));
  });

  it('never deletes on a failed replace that re-used the existing document', async () => {
    const user = userEvent.setup();
    // The ordinary path: the externalId matched, so `created` is false and the
    // document on screen is the one being replaced. Its stored file is untouched
    // by the failed PUT — deleting here would destroy the user's own document.
    const uploadDocument = vi
      .fn()
      .mockResolvedValue({ id: 'doc_1', created: false, uploadUrl: 'https://s3.example/put' });
    const deleteDocument = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    stub({
      getDocument: vi.fn().mockResolvedValue({
        id: 'doc_1',
        title: 'contract.pdf',
        status: 'ACTIVE',
        externalId: 'contract-7',
        fileType: 'application/pdf',
        storeText: false,
      }),
      uploadDocument,
      deleteDocument,
    });

    renderDetail();
    const file = new File(['new bytes'], 'contract-v2.pdf', { type: 'application/pdf' });
    await screen.findByRole('button', { name: 'Replace file' });
    await user.upload(screen.getByLabelText('Replacement file'), file);

    await vi.waitFor(() => expect(uploadDocument).toHaveBeenCalled());
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it('disables Replace file for a file-backed document without an externalId', async () => {
    stub({
      getDocument: vi.fn().mockResolvedValue({
        id: 'doc_1',
        title: 'Q1 Report',
        status: 'ACTIVE',
        fileType: 'application/pdf',
        storeText: false,
      }),
    });

    renderDetail();

    // No externalId ⇒ no re-upload identity ⇒ the action is disabled (with a
    // tooltip teaching why), not hidden.
    expect(await screen.findByRole('button', { name: 'Replace file' })).toBeDisabled();
  });

  // A document-surface schema with labelled/ordered fields — typed-metadata fixtures.
  const DECISION_SCHEMA = {
    id: 's_dec',
    typeName: 'decision',
    allowedSurfaces: ['document'],
    fields: [
      { fieldId: 'status', fieldType: 'string' },
      { fieldId: 'summary', fieldType: 'string' },
      { fieldId: 'tags', fieldType: 'array' },
    ],
    renderHints: { summary: { label: 'Summary', order: 1 }, status: { order: 2 } },
  };

  it('renders the typed metadata panel from the schema, with free-form keys as JSON', async () => {
    stub({
      getDocument: vi.fn().mockResolvedValue({
        id: 'doc_1',
        title: 'decision-note-1.md',
        schemaId: 's_dec',
        storeText: false,
        payload: {
          summary: 'Use DDB',
          status: 'accepted',
          tags: ['storage', 'adr'],
          freeform: 'extra',
        },
      }),
      schemas: vi.fn().mockResolvedValue(pageOf([DECISION_SCHEMA])),
    });

    renderDetail();

    // The header shows the resolved typeName; back preserves it for the list.
    expect(await screen.findByText('decision')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to documents/i })).toHaveAttribute(
      'href',
      '/documents?type=decision',
    );

    // Declared fields render labelled (renderHints) + formatted, hint-ordered.
    const metadata = (await screen.findByRole('heading', { name: 'Metadata' })).closest(
      'div',
    ) as HTMLElement;
    expect(within(metadata).getByText('Summary')).toBeInTheDocument(); // renderHints label
    expect(within(metadata).getByText('Use DDB')).toBeInTheDocument();
    expect(within(metadata).getByText('accepted')).toBeInTheDocument();
    // The array field renders via the shared cell formatter (compact JSON).
    expect(within(metadata).getByText('["storage","adr"]')).toBeInTheDocument();
    // Undeclared keys land in the Additional-fields JSON block.
    expect(within(metadata).getByText('Additional fields')).toBeInTheDocument();
    expect(within(metadata).getByText(/"freeform": "extra"/)).toBeInTheDocument();
  });

  it('omits the metadata panel when the document has no payload', async () => {
    stub({
      getDocument: vi.fn().mockResolvedValue({ id: 'doc_1', title: 'Plain', storeText: false }),
    });
    renderDetail();

    await screen.findByRole('heading', { name: 'Plain' });
    expect(screen.queryByRole('heading', { name: 'Metadata' })).not.toBeInTheDocument();
  });

  it('renders Markdown by default for a .md-titled document, with a raw toggle', async () => {
    const user = userEvent.setup();
    stub({
      getDocument: vi.fn().mockResolvedValue({ id: 'doc_1', title: 'decision-note-1.md', storeText: true }),
      getDocumentText: vi
        .fn()
        .mockResolvedValue({ id: 'doc_1', text: '# Heading One\n\nBody text.' }),
    });

    renderDetail();

    // Detected Markdown → rendered by default (a real heading element, not "# ").
    expect(await screen.findByRole('heading', { name: 'Heading One' })).toBeInTheDocument();

    // The raw view is one toggle away and shows the unrendered source.
    await user.click(screen.getByRole('button', { name: 'Raw' }));
    expect(await screen.findByText(/# Heading One/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Heading One' })).not.toBeInTheDocument();
  });

  it('defaults to the raw view for a non-Markdown text document, with a rendered toggle', async () => {
    const user = userEvent.setup();
    stub({
      getDocument: vi.fn().mockResolvedValue({ id: 'doc_1', title: 'notes', storeText: true }),
      getDocumentText: vi.fn().mockResolvedValue({ id: 'doc_1', text: '# Not detected' }),
    });

    renderDetail();

    // Undetected → raw source, no rendered heading.
    expect(await screen.findByText(/# Not detected/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Not detected' })).not.toBeInTheDocument();

    // The rendered view remains available on demand.
    await user.click(screen.getByRole('button', { name: 'Rendered' }));
    expect(await screen.findByRole('heading', { name: 'Not detected' })).toBeInTheDocument();
  });

  it('offers click-to-view for a file-mode Markdown document and renders the fetched file', async () => {
    const user = userEvent.setup();
    const getDocumentDownloadUrl = vi
      .fn()
      .mockResolvedValue({ downloadUrl: 'https://s3.example/get/doc_1' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# From The File\n\nFetched body.'),
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      stub({
        getDocument: vi.fn().mockResolvedValue({
          id: 'doc_1',
          title: 'kb-note.md',
          storeText: false,
          fileType: 'application/octet-stream',
          fileSize: 2048,
        }),
        getDocumentDownloadUrl,
      });
      renderDetail();

      // A viewable file-mode doc gets the positive offer (not the "isn't
      // stored" disclaimer), and nothing is fetched yet.
      await screen.findByText(/stored as its original file/i);
      expect(screen.queryByText(/isn.t stored/i)).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'View file contents' }));

      // Presigned URL minted, the original fetched, the Markdown rendered.
      expect(await screen.findByRole('heading', { name: 'From The File' })).toBeInTheDocument();
      expect(getDocumentDownloadUrl).toHaveBeenCalledWith({ id: 'doc_1' });
      expect(fetchMock).toHaveBeenCalledWith('https://s3.example/get/doc_1');

      // The Raw toggle still works on the fetched body.
      await user.click(screen.getByRole('button', { name: 'Raw' }));
      expect(await screen.findByText(/# From The File/)).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not offer click-to-view for a non-Markdown file', async () => {
    stub({
      getDocument: vi.fn().mockResolvedValue({
        id: 'doc_1',
        title: 'report.pdf',
        storeText: false,
        fileType: 'application/pdf',
        fileSize: 2048,
      }),
    });
    renderDetail();

    await screen.findByText(/isn.t stored/i);
    expect(screen.queryByRole('button', { name: 'View file contents' })).not.toBeInTheDocument();
  });

  it('surfaces an error when the file fetch fails, keeping download as the fallback', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    try {
      stub({
        getDocument: vi.fn().mockResolvedValue({
          id: 'doc_1',
          title: 'kb-note.md',
          storeText: false,
          fileType: 'text/markdown',
          fileSize: 2048,
        }),
        getDocumentDownloadUrl: vi
          .fn()
          .mockResolvedValue({ downloadUrl: 'https://s3.example/get/doc_1' }),
      });
      renderDetail();

      await user.click(await screen.findByRole('button', { name: 'View file contents' }));
      expect(await screen.findByText(/couldn.t load the file/i)).toBeInTheDocument();
      // The download action (file-backed doc) remains available.
      expect(screen.getByRole('button', { name: /download original/i })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not fetch text when the document has none stored', async () => {
    const getDocumentText = vi.fn();
    stub({
      getDocument: vi.fn().mockResolvedValue({ id: 'doc_1', title: 'No Text', storeText: false }),
      getDocumentText,
    });

    renderDetail();

    expect(await screen.findByText(/isn.t stored/i)).toBeInTheDocument();
    expect(getDocumentText).not.toHaveBeenCalled();
  });

  it('shows an error state when the document fails to load', async () => {
    stub({ getDocument: vi.fn().mockRejectedValue(new Error('404')) });
    renderDetail();
    expect(await screen.findByText(/couldn.t load this document/i)).toBeInTheDocument();
  });

  it('renders the document audit-trail history', async () => {
    stub({
      getDocument: vi.fn().mockResolvedValue({ id: 'doc_1', title: 'Policy', storeText: false }),
      getDocumentVersions: vi.fn().mockResolvedValue(
        pageOf([
          {
            id: 'v1',
            changeType: 'CREATE',
            changedBy: 'user_a',
            createdAt: '2026-06-10T10:00:00Z',
          },
          {
            id: 'v2',
            changeType: 'UPDATE',
            changedBy: 'user_b',
            createdAt: '2026-06-12T10:00:00Z',
            changedFields: { fields: ['title'] },
          },
        ]),
      ),
    });

    renderDetail();

    const history = await screen.findByRole('region', { name: 'History' });
    expect(within(history).getByText('Created')).toBeInTheDocument();
    expect(within(history).getByText('Updated')).toBeInTheDocument();
    expect(within(history).getByText(/Changed: title/)).toBeInTheDocument();
  });

  it('edits the document title (sending expectedVersion)', async () => {
    const user = userEvent.setup();
    const updateDocument = vi.fn().mockResolvedValue({ id: 'doc_1' });
    stub({
      getDocument: vi
        .fn()
        .mockResolvedValue({ id: 'doc_1', title: 'Old', indexMode: 'HYBRID', version: 2 }),
      updateDocument,
    });
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const titleField = within(dialog).getByRole('textbox', { name: 'Title' });
    await user.clear(titleField);
    await user.type(titleField, 'New Title');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await vi.waitFor(() =>
      expect(updateDocument).toHaveBeenCalledWith({
        id: 'doc_1',
        body: { title: 'New Title', indexMode: 'HYBRID', expectedVersion: 2 },
      }),
    );
  });

  it('opens the document-ask drawer from the header', async () => {
    const user = userEvent.setup();
    stub({ getDocument: vi.fn().mockResolvedValue({ id: 'doc_1', title: 'Doc' }) });
    renderDetail();

    await user.click(await screen.findByRole('button', { name: /ask this document/i }));
    // The drawer opens with its prompt box (unique to the drawer).
    expect(
      await screen.findByRole('textbox', { name: /ask a question about this document/i }),
    ).toBeInTheDocument();
  });

  it('deletes the document after confirmation, then navigates to the list', async () => {
    const user = userEvent.setup();
    const deleteDocument = vi.fn().mockResolvedValue(undefined);
    stub({ getDocument: vi.fn().mockResolvedValue({ id: 'doc_1', title: 'Doc' }), deleteDocument });
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete document' }));

    await vi.waitFor(() => expect(deleteDocument).toHaveBeenCalledWith({ id: 'doc_1' }));
    expect(await screen.findByText('documents list')).toBeInTheDocument();
  });

  it('lands on the by-type list after deleting a typed document', async () => {
    const user = userEvent.setup();
    const deleteDocument = vi.fn().mockResolvedValue(undefined);
    stub({
      getDocument: vi
        .fn()
        .mockResolvedValue({ id: 'doc_1', title: 'decision-note-1.md', schemaId: 's_dec', storeText: false }),
      schemas: vi.fn().mockResolvedValue(pageOf([DECISION_SCHEMA])),
      deleteDocument,
    });
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete document' }));

    // The list route renders AND the URL carries the document's type.
    expect(await screen.findByText('documents list')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/documents?type=decision');
  });
});

// The download link comes back from the API as a presigned storage URL. It is opened only
// when it is https: a script scheme handed to window.open would run in this origin.
describe('DocumentDetailPage download link', () => {
  const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  beforeEach(() => {
    mockedClient.mockReset();
    openSpy.mockClear();
  });

  async function clickDownload(downloadUrl: string): Promise<void> {
    const getDocumentDownloadUrl = vi.fn().mockResolvedValue({ downloadUrl });
    stub({
      getDocument: vi.fn().mockResolvedValue({
        id: 'doc_1',
        title: 'Q1 Report',
        status: 'ACTIVE',
        indexStatus: 'INDEXED',
        storeText: true,
        fileType: 'application/pdf',
        fileSize: 2048,
        version: 1,
      }),
      getDocumentDownloadUrl,
    });
    renderDetail();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /download original/i }));
    await waitFor(() => expect(getDocumentDownloadUrl).toHaveBeenCalledTimes(1));
  }

  it.each([
    ['javascript:', 'javascript:alert(document.domain)'],
    ['a mixed-case script scheme', 'JaVaScRiPt:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['plain http', 'http://s3.example/get/doc_1'],
    ['protocol-relative', '//evil.example/get'],
    ['a relative path', '/get/doc_1'],
  ])('does not open a download link that is %s, and says it was refused (no "try again")', async (_name, downloadUrl) => {
    await clickDownload(downloadUrl);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/not a secure \(https\) address/i);
    expect(alert).not.toHaveTextContent(/please try again/i);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('says the link could not be generated (a retry can help) when the API returns none', async () => {
    await clickDownload('');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn't generate a download link/i);
    expect(alert).toHaveTextContent(/please try again/i);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('opens an https download link, with the checked (normalised) value (control)', async () => {
    await clickDownload('  HTTPS://S3.Example/get/doc_1?X-Amz-Signature=abc  ');

    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'https://s3.example/get/doc_1?X-Amz-Signature=abc',
        '_blank',
        'noopener,noreferrer',
      ),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// The other two places this page sends a request to an address the API supplied: the replacement
// upload (a PUT of the user's file) and the in-page file view (a GET). Neither may go to anything
// but https, and a refused address must send nothing.
describe('DocumentDetailPage requests to API-supplied addresses', () => {
  beforeEach(() => {
    mockedClient.mockReset();
  });

  const NOT_HTTPS: ReadonlyArray<readonly [string, string]> = [
    ['plain http', 'http://s3.example/put'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/plain,x'],
    ['protocol-relative', '//evil.example/put'],
    ['a relative path', '/put'],
  ];

  it.each(NOT_HTTPS)('does not PUT the replacement file to %s', async (_name, uploadUrl) => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    try {
      stub({
        getDocument: vi.fn().mockResolvedValue({
          id: 'doc_1',
          title: 'Q1 Report',
          status: 'ACTIVE',
          externalId: 'q1-report',
          fileType: 'application/pdf',
          storeText: false,
        }),
        uploadDocument: vi.fn().mockResolvedValue({ id: 'doc_1', uploadUrl }),
      });
      renderDetail();

      await screen.findByRole('button', { name: 'Replace file' });
      await user.upload(
        screen.getByLabelText('Replacement file'),
        new File(['new bytes'], 'q1-v2.pdf', { type: 'application/pdf' }),
      );

      expect(await screen.findByText(/couldn't replace the file/i)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('PUTs the replacement file to the checked (normalised) https address, not the raw value (control)', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    try {
      stub({
        getDocument: vi.fn().mockResolvedValue({
          id: 'doc_1',
          title: 'Q1 Report',
          status: 'ACTIVE',
          externalId: 'q1-report',
          fileType: 'application/pdf',
          storeText: false,
        }),
        uploadDocument: vi
          .fn()
          .mockResolvedValue({ id: 'doc_1', uploadUrl: '  HTTPS://S3.Example/re-put?X-Amz-Signature=abc  ' }),
      });
      renderDetail();

      await screen.findByRole('button', { name: 'Replace file' });
      await user.upload(
        screen.getByLabelText('Replacement file'),
        new File(['new bytes'], 'q1-v2.pdf', { type: 'application/pdf' }),
      );

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          'https://s3.example/re-put?X-Amz-Signature=abc',
          expect.objectContaining({ method: 'PUT' }),
        ),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(NOT_HTTPS)('does not fetch the file view from %s', async (_name, downloadUrl) => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '# hi' });
    vi.stubGlobal('fetch', fetchMock);
    try {
      stub({
        getDocument: vi.fn().mockResolvedValue({
          id: 'doc_1',
          title: 'kb-note.md',
          storeText: false,
          fileType: 'text/markdown',
          fileSize: 2048,
        }),
        getDocumentDownloadUrl: vi.fn().mockResolvedValue({ downloadUrl }),
      });
      renderDetail();

      await user.click(await screen.findByRole('button', { name: 'View file contents' }));

      expect(await screen.findByText(/couldn.t load the file/i)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fetches the file view from the checked (normalised) https address (control)', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '# hi' });
    vi.stubGlobal('fetch', fetchMock);
    try {
      stub({
        getDocument: vi.fn().mockResolvedValue({
          id: 'doc_1',
          title: 'kb-note.md',
          storeText: false,
          fileType: 'text/markdown',
          fileSize: 2048,
        }),
        getDocumentDownloadUrl: vi
          .fn()
          .mockResolvedValue({ downloadUrl: '  HTTPS://S3.Example/get/doc_1?X-Amz-Signature=abc  ' }),
      });
      renderDetail();

      await user.click(await screen.findByRole('button', { name: 'View file contents' }));

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith('https://s3.example/get/doc_1?X-Amz-Signature=abc'),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
