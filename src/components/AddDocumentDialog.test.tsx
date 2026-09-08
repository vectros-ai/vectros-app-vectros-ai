// ---------------------------------------------------------------------------
// AddDocumentDialog tests — the multi-step upload path (presign → S3 PUT) is the
// riskiest data flow in the app, and its failure branches were previously only
// happy-path-exercised. Covers: upload success, the missing-presigned-URL and
// failed-S3-PUT error branches, ingest success, and folder wiring — plus the
// compensation those two failure branches owe: the document created before the
// bytes existed is deleted again, while one merely matched by externalId (which
// predates the call, bytes intact) is deliberately left alone.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CurrentTenantProvider } from '@vectros-ai/react';
import type { TenantMembership } from '@vectros-ai/react';

import { AddDocumentDialog } from './AddDocumentDialog';
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

function stub(
  documents: Record<string, unknown>,
  schemas: ReadonlyArray<unknown> = [],
): void {
  mockedClient.mockReturnValue({
    documents,
    // The dialog's Type picker enumerates document-surface schemas.
    schemas: { listSchemas: vi.fn().mockResolvedValue({ data: schemas }) },
  } as never);
}

function renderDialog(
  opts: {
    folders?: ReadonlyArray<FolderResponse>;
    defaultFolderId?: string;
    defaultTypeName?: string;
  } = {},
): { onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn();
  render(
    <TestProviders>
      <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
        <CurrentContextProvider
          initialContexts={[{ contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' }]}
          initialContext="default"
        >
          <AddDocumentDialog
            open
            folders={opts.folders ?? []}
            defaultFolderId={opts.defaultFolderId}
            defaultTypeName={opts.defaultTypeName}
            onClose={onClose}
          />
        </CurrentContextProvider>
      </CurrentTenantProvider>
    </TestProviders>,
  );
  return { onClose };
}

const FILE = new File(['hello'], 'report.pdf', { type: 'application/pdf' });

describe('AddDocumentDialog — upload mode', () => {
  beforeEach(() => mockedClient.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it('presigns, PUTs the bytes to S3, and closes on success', async () => {
    const user = userEvent.setup();
    const uploadDocument = vi.fn().mockResolvedValue({ uploadUrl: 'https://s3.example/put' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    stub({ uploadDocument });

    const { onClose } = renderDialog();
    await user.upload(screen.getByLabelText('File'), FILE);
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    await vi.waitFor(() =>
      expect(uploadDocument).toHaveBeenCalledWith({
        fileName: 'report.pdf',
        fileType: 'application/pdf',
        indexMode: 'HYBRID',
        storeText: true,
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://s3.example/put',
      expect.objectContaining({ method: 'PUT', body: FILE }),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('forwards storeText:false when the "keep the extracted text" switch is turned off', async () => {
    const user = userEvent.setup();
    const uploadDocument = vi.fn().mockResolvedValue({ uploadUrl: 'https://s3.example/put' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    stub({ uploadDocument });

    renderDialog();
    await user.upload(screen.getByLabelText('File'), FILE);
    // Default is retain (true); turn it off to discard the extracted text.
    await user.click(screen.getByRole('switch', { name: 'Keep the extracted text' }));
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    await vi.waitFor(() =>
      expect(uploadDocument).toHaveBeenCalledWith(
        expect.objectContaining({ storeText: false }),
      ),
    );
  });

  it('shows an error and stays open when no presigned URL comes back', async () => {
    const user = userEvent.setup();
    const uploadDocument = vi.fn().mockResolvedValue({}); // no uploadUrl
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    stub({ uploadDocument });

    const { onClose } = renderDialog();
    await user.upload(screen.getByLabelText('File'), FILE);
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t add this document/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows an error when the S3 PUT fails', async () => {
    const user = userEvent.setup();
    const uploadDocument = vi.fn().mockResolvedValue({ uploadUrl: 'https://s3.example/put' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    stub({ uploadDocument });

    const { onClose } = renderDialog();
    await user.upload(screen.getByLabelText('File'), FILE);
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  // --- Compensation: the presign->PUT pair is not one transaction ------------
  // uploadDocument() creates the document row BEFORE the bytes exist, so every
  // failure after it has to undo that row or the user is left with a phantom,
  // byte-less document they cannot remove from the app.

  it('deletes the document it created when the S3 PUT fails', async () => {
    const user = userEvent.setup();
    const uploadDocument = vi
      .fn()
      .mockResolvedValue({ id: 'doc_new', created: true, uploadUrl: 'https://s3.example/put' });
    const deleteDocument = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    stub({ uploadDocument, deleteDocument });

    const { onClose } = renderDialog();
    await user.upload(screen.getByLabelText('File'), FILE);
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    await vi.waitFor(() => expect(deleteDocument).toHaveBeenCalledWith({ id: 'doc_new' }));
    // The original PUT failure is still what the user sees, and the dialog stays
    // open so the upload can be retried.
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t add this document/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('deletes the document it created when no presigned URL comes back', async () => {
    const user = userEvent.setup();
    // The document row exists even though there is no URL to place bytes at,
    // so this branch strands a phantom exactly as a rejected PUT does.
    const uploadDocument = vi.fn().mockResolvedValue({ id: 'doc_new', created: true });
    const deleteDocument = vi.fn().mockResolvedValue({});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    stub({ uploadDocument, deleteDocument });

    renderDialog();
    await user.upload(screen.getByLabelText('File'), FILE);
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    await vi.waitFor(() => expect(deleteDocument).toHaveBeenCalledWith({ id: 'doc_new' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never deletes a document merely MATCHED by externalId when the PUT fails', async () => {
    const user = userEvent.setup();
    // created:false = the externalId matched a document that already existed.
    // A failed PUT leaves its stored bytes untouched; deleting it would destroy
    // the user's own data to clean up a write that never landed.
    const uploadDocument = vi
      .fn()
      .mockResolvedValue({ id: 'doc_preexisting', created: false, uploadUrl: 'https://s3.example/put' });
    const deleteDocument = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    stub({ uploadDocument, deleteDocument });

    renderDialog();
    await user.upload(screen.getByLabelText('File'), FILE);
    await user.type(screen.getByLabelText('External ID (optional)'), 'po-42');
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    // The failure still surfaces...
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t add this document/i);
    // ...but the pre-existing document is left alone.
    expect(deleteDocument).not.toHaveBeenCalled();
    // Pin the input that makes `created:false` reachable at all — without an
    // externalId the API can never return a match, so a cell that did not send
    // one would be asserting against a case it had not actually set up.
    expect(uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'po-42' }),
    );
  });

  it('surfaces the original upload error even when the compensating delete fails', async () => {
    const user = userEvent.setup();
    const uploadDocument = vi
      .fn()
      .mockResolvedValue({ id: 'doc_new', created: true, uploadUrl: 'https://s3.example/put' });
    // The cleanup failure carries a requestId; the upload failure does not. The
    // alert's body text is identical either way (it is a static message), so the
    // rendered Reference ID is the ONLY thing that distinguishes which error
    // reached the user — assert on that rather than on text that cannot tell them
    // apart. e.g. a credential that can create documents but not delete them.
    // `body.requestId`, not a bare `requestId` — that is the shape
    // RequestIdCaption's own extractor reads, and putting it anywhere else makes
    // the assertion below pass for the wrong reason.
    const cleanupError = Object.assign(new Error('403 forbidden'), {
      body: { requestId: 'cleanup-request-id' },
    });
    const deleteDocument = vi.fn().mockRejectedValue(cleanupError);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    stub({ uploadDocument, deleteDocument });

    const { onClose } = renderDialog();
    await user.upload(screen.getByLabelText('File'), FILE);
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    await vi.waitFor(() => expect(deleteDocument).toHaveBeenCalled());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t add this document/i);
    // The cleanup error did NOT replace the upload error.
    expect(alert).not.toHaveTextContent('cleanup-request-id');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not delete when the response cannot prove this call created the document', async () => {
    const user = userEvent.setup();
    // No `created` flag at all. The guard is `=== true` rather than a truthiness
    // check precisely for this: absent means "cannot prove we made it", which has
    // to fall on the side of keeping the document. A weakening of the guard to
    // `!== false` inverts that, and this is the cell that catches it.
    const uploadDocument = vi
      .fn()
      .mockResolvedValue({ id: 'doc_unknown', uploadUrl: 'https://s3.example/put' });
    const deleteDocument = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    stub({ uploadDocument, deleteDocument });

    renderDialog();
    await user.upload(screen.getByLabelText('File'), FILE);
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t add this document/i);
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it('rejects an oversize file up front with a message + disabled Upload', async () => {
    const user = userEvent.setup();
    const uploadDocument = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    stub({ uploadDocument });

    renderDialog();
    // A File whose reported size exceeds the 100 MB cap (no real bytes allocated).
    const huge = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(huge, 'size', { value: 200 * 1024 * 1024 });
    await user.upload(screen.getByLabelText('File'), huge);

    expect(screen.getByText(/larger than the 100 MB limit/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
    // It must never reach the presign/PUT (which would 200 then land FAILED).
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a clear name + size for the chosen file, with a hint before any selection', async () => {
    const user = userEvent.setup();
    stub({ uploadDocument: vi.fn() });
    renderDialog();

    // Before selecting: an explicit hint, no file shown.
    expect(screen.getByText('No file chosen yet.')).toBeInTheDocument();

    await user.upload(screen.getByLabelText('File'), FILE);

    // After selecting: the file name (and size) is shown; the hint is gone.
    expect(screen.getByText(/report\.pdf/)).toBeInTheDocument();
    expect(screen.queryByText('No file chosen yet.')).not.toBeInTheDocument();
  });

  it("defaults the target folder to the list's current folder", () => {
    stub({ uploadDocument: vi.fn() });
    const folders = [{ id: 'fld_1', name: 'Invoices' }] as FolderResponse[];
    renderDialog({ folders, defaultFolderId: 'fld_1' });

    expect(screen.getByRole('combobox', { name: 'Folder (optional)' })).toHaveTextContent(
      'Invoices',
    );
  });

  it('accepts a within-limit file (Upload enabled, no warning)', async () => {
    const user = userEvent.setup();
    stub({ uploadDocument: vi.fn() });
    renderDialog();

    const ok = new File(['x'], 'ok.pdf', { type: 'application/pdf' });
    Object.defineProperty(ok, 'size', { value: 5 * 1024 * 1024 });
    await user.upload(screen.getByLabelText('File'), ok);

    expect(screen.queryByText(/larger than the 100 MB limit/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled();
  });
});

describe('AddDocumentDialog — ingest mode', () => {
  beforeEach(() => mockedClient.mockReset());

  it('ingests title + text and closes on success', async () => {
    const user = userEvent.setup();
    const ingestDocument = vi.fn().mockResolvedValue({ id: 'doc_1' });
    stub({ ingestDocument });

    const { onClose } = renderDialog();
    await user.click(screen.getByRole('button', { name: /ingest text/i }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Notes');
    await user.type(screen.getByRole('textbox', { name: /text content/i }), 'Body text');
    await user.click(screen.getByRole('button', { name: 'Ingest' }));

    await vi.waitFor(() =>
      expect(ingestDocument).toHaveBeenCalledWith(
        // The request body nests under `body` (SDK 0.31 un-inlined it when `?upsert` was added).
        expect.objectContaining({
          body: expect.objectContaining({ title: 'Notes', text: 'Body text', indexMode: 'HYBRID' }),
        }),
      ),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('keeps the submit disabled until both title and text are present', async () => {
    const user = userEvent.setup();
    stub({ ingestDocument: vi.fn() });
    renderDialog();

    await user.click(screen.getByRole('button', { name: /ingest text/i }));
    const submit = screen.getByRole('button', { name: 'Ingest' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Only title');
    expect(submit).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /text content/i }), 'now text');
    expect(submit).toBeEnabled();
  });

  it('warns and stays open when an externalId matched an existing document without upsert', async () => {
    const user = userEvent.setup();
    // created:false without upsert ⇒ the existing document came back UNCHANGED —
    // the submitted title/text were NOT applied. Closing silently would fake a save.
    const ingestDocument = vi.fn().mockResolvedValue({ id: 'doc_1', created: false });
    stub({ ingestDocument });

    const { onClose } = renderDialog();
    await user.click(screen.getByRole('button', { name: /ingest text/i }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Notes v2');
    await user.type(screen.getByRole('textbox', { name: /text content/i }), 'Changed body');
    await user.type(screen.getByRole('textbox', { name: /external id/i }), 'notes-1');
    await user.click(screen.getByRole('button', { name: 'Ingest' }));

    expect(await screen.findByText(/NOT applied/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // No upsert flag went out on the plain create.
    expect(ingestDocument).toHaveBeenCalledWith(
      expect.not.objectContaining({ upsert: true }),
    );
  });

  it('sends upsert:true when "update if it already exists" is on, and closes', async () => {
    const user = userEvent.setup();
    // With upsert the submitted content IS applied to the match (created:false).
    const ingestDocument = vi.fn().mockResolvedValue({ id: 'doc_1', created: false });
    stub({ ingestDocument });

    const { onClose } = renderDialog();
    await user.click(screen.getByRole('button', { name: /ingest text/i }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Notes v2');
    await user.type(screen.getByRole('textbox', { name: /text content/i }), 'Changed body');
    // The upsert switch appears only once an externalId is entered.
    expect(
      screen.queryByRole('switch', { name: /update it if it already exists/i }),
    ).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /external id/i }), 'notes-1');
    await user.click(screen.getByRole('switch', { name: /update it if it already exists/i }));
    await user.click(screen.getByRole('button', { name: 'Ingest' }));

    await vi.waitFor(() =>
      expect(ingestDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          upsert: true,
          body: expect.objectContaining({ title: 'Notes v2', externalId: 'notes-1' }),
        }),
      ),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('AddDocumentDialog — ownership scopes', () => {
  beforeEach(() => mockedClient.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it('ingest default (Inherit) sends NO scopes key', async () => {
    const user = userEvent.setup();
    const ingestDocument = vi.fn().mockResolvedValue({ id: 'doc_1' });
    stub({ ingestDocument });
    renderDialog();
    await user.click(screen.getByRole('button', { name: /ingest text/i }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Notes');
    await user.type(screen.getByRole('textbox', { name: /text content/i }), 'Body');
    await user.click(screen.getByRole('button', { name: 'Ingest' }));

    await vi.waitFor(() => expect(ingestDocument).toHaveBeenCalled());
    const body = ingestDocument.mock.calls[0]?.[0]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('scopes');
  });

  it('ingest + Private sends scopes: []', async () => {
    const user = userEvent.setup();
    const ingestDocument = vi.fn().mockResolvedValue({ id: 'doc_1' });
    stub({ ingestDocument });
    renderDialog();
    await user.click(screen.getByRole('button', { name: /ingest text/i }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Notes');
    await user.type(screen.getByRole('textbox', { name: /text content/i }), 'Body');
    await user.click(screen.getByRole('radio', { name: /private/i }));
    await user.click(screen.getByRole('button', { name: 'Ingest' }));

    await vi.waitFor(() =>
      expect(ingestDocument).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.objectContaining({ scopes: [] }) }),
      ),
    );
  });

  it('ingest + Custom sends the namespace:value scope', async () => {
    const user = userEvent.setup();
    const ingestDocument = vi.fn().mockResolvedValue({ id: 'doc_1' });
    stub({ ingestDocument });
    renderDialog();
    await user.click(screen.getByRole('button', { name: /ingest text/i }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Notes');
    await user.type(screen.getByRole('textbox', { name: /text content/i }), 'Body');
    await user.click(screen.getByRole('radio', { name: /custom scopes/i }));
    await user.type(screen.getByRole('textbox', { name: /namespace/i }), 'group');
    await user.type(screen.getByRole('textbox', { name: /^value$/i }), 'eng');
    await user.click(screen.getByRole('button', { name: 'Ingest' }));

    await vi.waitFor(() =>
      expect(ingestDocument).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.objectContaining({ scopes: ['group:eng'] }) }),
      ),
    );
  });

  it('ingest with an invalid custom scope disables Ingest', async () => {
    const user = userEvent.setup();
    stub({ ingestDocument: vi.fn() });
    renderDialog();
    await user.click(screen.getByRole('button', { name: /ingest text/i }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Notes');
    await user.type(screen.getByRole('textbox', { name: /text content/i }), 'Body');
    await user.click(screen.getByRole('radio', { name: /custom scopes/i }));
    await user.type(screen.getByRole('textbox', { name: /namespace/i }), 'tenant'); // reserved
    await user.type(screen.getByRole('textbox', { name: /^value$/i }), 'x');
    expect(screen.getByRole('button', { name: 'Ingest' })).toBeDisabled();
  });

  it('the upload path exposes NO ownership control and sends no scopes', async () => {
    const user = userEvent.setup();
    const uploadDocument = vi.fn().mockResolvedValue({ uploadUrl: 'https://s3.example/put' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    stub({ uploadDocument });
    renderDialog();
    // Upload mode is the default — no ownership radios are rendered.
    expect(screen.queryByRole('radio', { name: /private/i })).not.toBeInTheDocument();
    await user.upload(screen.getByLabelText('File'), FILE);
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    await vi.waitFor(() => expect(uploadDocument).toHaveBeenCalled());
    expect(uploadDocument).not.toHaveBeenCalledWith(
      expect.objectContaining({ scopes: expect.anything() }),
    );
  });
});

describe('AddDocumentDialog — externalId on upload', () => {
  beforeEach(() => mockedClient.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it('passes the externalId through to the upload initiation', async () => {
    const user = userEvent.setup();
    const uploadDocument = vi
      .fn()
      .mockResolvedValue({ id: 'doc_1', uploadUrl: 'https://s3.example/put', created: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    stub({ uploadDocument });

    const { onClose } = renderDialog();
    await user.upload(screen.getByLabelText('File'), FILE);
    await user.type(screen.getByRole('textbox', { name: /external id/i }), 'report-2026-q1');
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    await vi.waitFor(() =>
      expect(uploadDocument).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: 'report.pdf', externalId: 'report-2026-q1' }),
      ),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('AddDocumentDialog — typed create (document-surface schemas)', () => {
  beforeEach(() => mockedClient.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  const CONTRACT_TYPE = {
    id: 'sch_contract',
    typeName: 'contract',
    allowedSurfaces: ['document'],
    fields: [{ fieldId: 'category', fieldType: 'string' }],
  };

  it('binds the selected type and sends the form-authored metadata on upload', async () => {
    const user = userEvent.setup();
    const uploadDocument = vi
      .fn()
      .mockResolvedValue({ id: 'doc_1', uploadUrl: 'https://s3.example/put', created: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    stub({ uploadDocument }, [CONTRACT_TYPE]);

    const { onClose } = renderDialog();
    await user.upload(screen.getByLabelText('File'), FILE);
    await user.click(await screen.findByLabelText('Type (optional)'));
    await user.click(await screen.findByRole('option', { name: 'contract' }));
    await user.type(screen.getByRole('textbox', { name: 'category' }), 'nda');
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    await vi.waitFor(() =>
      expect(uploadDocument).toHaveBeenCalledWith(
        expect.objectContaining({ schemaId: 'sch_contract', payload: { category: 'nda' } }),
      ),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('binds the selected type and metadata on text ingest too', async () => {
    const user = userEvent.setup();
    const ingestDocument = vi.fn().mockResolvedValue({ id: 'doc_2', created: true });
    stub({ ingestDocument }, [CONTRACT_TYPE]);

    const { onClose } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Ingest text' }));
    await user.type(screen.getByRole('textbox', { name: /title/i }), 'MSA');
    await user.type(screen.getByRole('textbox', { name: /text content/i }), 'terms…');
    await user.click(await screen.findByLabelText('Type (optional)'));
    await user.click(await screen.findByRole('option', { name: 'contract' }));
    await user.type(screen.getByRole('textbox', { name: 'category' }), 'msa');
    await user.click(screen.getByRole('button', { name: 'Ingest' }));

    await vi.waitFor(() =>
      expect(ingestDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ schemaId: 'sch_contract', payload: { category: 'msa' } }),
        }),
      ),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('gates submit on a required typed field until it is filled', async () => {
    const user = userEvent.setup();
    const uploadDocument = vi.fn();
    stub({ uploadDocument }, [
      {
        ...CONTRACT_TYPE,
        fields: [{ fieldId: 'category', fieldType: 'string', required: true }],
      },
    ]);

    renderDialog();
    await user.upload(screen.getByLabelText('File'), FILE);
    await user.click(await screen.findByLabelText('Type (optional)'));
    await user.click(await screen.findByRole('option', { name: 'contract' }));
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: 'category *' }), 'nda');
    expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled();
  });

  it('dedupes a base+variant pair sharing one typeName to a single option, and binds the recordType-resolved schema (not an arbitrary raw-list row)', async () => {
    const user = userEvent.setup();
    const uploadDocument = vi
      .fn()
      .mockResolvedValue({ id: 'doc_1', uploadUrl: 'https://s3.example/put', created: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const BASE = { id: 'sch_base', typeName: 'contract', allowedSurfaces: ['document'], fields: [] };
    const VARIANT = {
      id: 'sch_variant',
      basedOn: 'sch_base',
      typeName: 'contract',
      allowedSurfaces: ['document'],
      fields: [],
    };
    const listSchemas = vi.fn((req?: { recordType?: string }) =>
      Promise.resolve({
        data: req?.recordType === 'contract' ? [VARIANT] : [BASE, VARIANT],
      }),
    );
    mockedClient.mockReturnValue({ documents: { uploadDocument }, schemas: { listSchemas } } as never);

    renderDialog();
    await user.upload(screen.getByLabelText('File'), FILE);
    await user.click(await screen.findByLabelText('Type (optional)'));
    // Exactly one "contract" option — no duplicate-key collision.
    expect(await screen.findAllByRole('option', { name: 'contract' })).toHaveLength(1);
    await user.click(screen.getByRole('option', { name: 'contract' }));
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    // Bound to the RESOLVED variant's id, never the base's.
    await vi.waitFor(() =>
      expect(uploadDocument).toHaveBeenCalledWith(expect.objectContaining({ schemaId: 'sch_variant' })),
    );
  });

  it('pre-selects the type handed down from the list’s active by-type view', async () => {
    const user = userEvent.setup();
    const uploadDocument = vi
      .fn()
      .mockResolvedValue({ id: 'doc_1', uploadUrl: 'https://s3.example/put', created: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    stub({ uploadDocument }, [CONTRACT_TYPE]);

    renderDialog({ defaultTypeName: 'contract' });

    // The picker arrives already set to the list's type (still changeable)…
    expect(
      await screen.findByRole('combobox', { name: 'Type (optional)' }),
    ).toHaveTextContent('contract');
    // …and the create carries it without the user touching the picker.
    await user.upload(screen.getByLabelText('File'), FILE);
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    await vi.waitFor(() =>
      expect(uploadDocument).toHaveBeenCalledWith(
        expect.objectContaining({ schemaId: 'sch_contract' }),
      ),
    );
  });

  it('hides the Type picker when no document-surface types exist', async () => {
    const listSchemas = vi.fn().mockResolvedValue({
      data: [{ id: 'sch_rec', typeName: 'ticket', allowedSurfaces: ['record'], fields: [] }],
    });
    mockedClient.mockReturnValue({
      documents: { uploadDocument: vi.fn() },
      schemas: { listSchemas },
    } as never);
    renderDialog();
    // Wait for the schemas query to actually resolve (record-surface only),
    // then settle the render — the picker must still be absent.
    await vi.waitFor(() => expect(listSchemas).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'Upload' });
    expect(screen.queryByLabelText('Type (optional)')).not.toBeInTheDocument();
  });
});
