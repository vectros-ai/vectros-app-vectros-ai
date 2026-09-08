// ---------------------------------------------------------------------------
// DocumentsPage tests — folder filter + documents table, with the SDK mocked.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { CurrentTenantProvider } from '@vectros-ai/react';
import type { TenantMembership } from '@vectros-ai/react';

import { DocumentsPage } from './DocumentsPage';
import { CurrentContextProvider } from '../../auth/CurrentContextProvider';
import { TestProviders } from '../../test/TestProviders';
import { pageOf, pageOfWithCursor, sealedCursor } from '../../test/pageOf';

/** An empty inference stream — lets a documentAsk submit complete cleanly. */
async function* emptyStream(): AsyncGenerator<never> {
  // no events
}

/** Surfaces the router location so navigation (deep-links) can be asserted. */
function LocationProbe(): React.JSX.Element {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

vi.mock('../../api/vectrosApi', () => ({ vectrosApiClient: vi.fn() }));
import { vectrosApiClient } from '../../api/vectrosApi';

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

function stub(opts: {
  folders?: () => Promise<unknown>;
  documents?: () => Promise<unknown>;
  schemas?: () => Promise<unknown>;
  createFolder?: (req: unknown) => Promise<unknown>;
  deleteFolder?: (req: { id: string }) => Promise<void>;
  ingestDocument?: (req: unknown) => Promise<unknown>;
  uploadDocument?: (req: unknown) => Promise<unknown>;
  lookupDocumentsByBody?: (req: unknown) => Promise<unknown>;
  documentAsk?: (req: unknown, opts?: unknown) => Promise<unknown>;
}): void {
  mockedClient.mockReturnValue({
    folders: {
      listFolders: opts.folders ?? vi.fn().mockResolvedValue(pageOf([])),
      createFolder: opts.createFolder ?? vi.fn().mockResolvedValue({ id: 'new' }),
      updateFolder: vi.fn().mockResolvedValue({ id: 'f1' }),
      deleteFolder: opts.deleteFolder ?? vi.fn().mockResolvedValue(undefined),
    },
    schemas: {
      listSchemas: opts.schemas ?? vi.fn().mockResolvedValue(pageOf([])),
    },
    documents: {
      listDocuments: opts.documents ?? vi.fn().mockResolvedValue(pageOf([])),
      ingestDocument: opts.ingestDocument ?? vi.fn().mockResolvedValue({ id: 'doc_new' }),
      uploadDocument:
        opts.uploadDocument ??
        vi.fn().mockResolvedValue({ id: 'doc_up', uploadUrl: 'https://s3.example/put' }),
      lookupDocumentsByBody: opts.lookupDocumentsByBody ?? vi.fn().mockResolvedValue(pageOf([])),
    },
    // The per-row "Ask" drawer mounts the model picker (useInferenceModels)
    // and, on submit, streams documentAsk. An empty catalogue renders the
    // drawer; documentAsk resolves an empty stream so a submit completes.
    inference: {
      listInferenceModels: vi.fn().mockResolvedValue({ models: [] }),
      documentAsk: opts.documentAsk ?? vi.fn(() => Promise.resolve(emptyStream())),
    },
  } as never);
}

function renderPage(initialEntries?: string[]): void {
  render(
    <TestProviders {...(initialEntries ? { initialEntries } : {})}>
      <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
        <CurrentContextProvider
          initialContexts={[{ contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' }]}
          initialContext="default"
        >
          <DocumentsPage />
          <LocationProbe />
        </CurrentContextProvider>
      </CurrentTenantProvider>
    </TestProviders>,
  );
}

describe('DocumentsPage', () => {
  beforeEach(() => mockedClient.mockReset());

  it('lists documents with a link to detail, status, index chip, and folder name', async () => {
    stub({
      folders: vi.fn().mockResolvedValue(pageOf([{ id: 'f1', name: 'Reports' }])),
      documents: vi.fn().mockResolvedValue(pageOf([
        {
          id: 'doc_1',
          title: 'Q1 Report',
          status: 'ACTIVE',
          indexStatus: 'INDEXED',
          folderId: 'f1',
          fileType: 'application/pdf',
          fileSize: 2048,
        },
      ])),
    });

    renderPage();

    const link = await screen.findByRole('link', { name: 'Q1 Report' });
    expect(link).toHaveAttribute('href', '/documents/doc_1');
    // Lifecycle status and the processing state render as separate columns.
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Indexed')).toBeInTheDocument();
    // Folder name resolved in the document row (scoped to the table — the name
    // also appears in the folder-management card).
    const table = screen.getByRole('table', { name: /documents/i });
    expect(within(table).getByText('Reports')).toBeInTheDocument();
  });

  it('refetches the document list when the refresh button is clicked', async () => {
    const user = userEvent.setup();
    const listDocuments = vi
      .fn()
      .mockResolvedValue(
        pageOf([{ id: 'doc_1', title: 'Q1 Report', status: 'ACTIVE', indexStatus: 'PENDING_INDEX' }]),
      );
    stub({ documents: listDocuments });

    renderPage();

    await screen.findByRole('link', { name: 'Q1 Report' });
    const before = listDocuments.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Refresh documents' }));
    await waitFor(() => expect(listDocuments.mock.calls.length).toBeGreaterThan(before));
  });

  it('drains a scope-filtered document list past page 1 on the opaque cursor', async () => {
    // The live path the sealed cursor breaks: an ownership-scope filter makes
    // the API mint an opaque composite cursor, and the second page is only
    // reachable by echoing it back — a row id is refused outright. The middle
    // page is EMPTY with a live cursor, because a scope filter is applied to
    // each page after that page's cursor is captured.
    const user = userEvent.setup();
    const pages = [
      pageOfWithCursor(
        [{ id: 'doc_1', title: 'Scoped One', status: 'ACTIVE', indexStatus: 'INDEXED' }],
        sealedCursor(1),
      ),
      pageOfWithCursor([], sealedCursor(2)),
      pageOf([{ id: 'doc_2', title: 'Scoped Two', status: 'ACTIVE', indexStatus: 'INDEXED' }]),
    ];
    const listDocuments = vi.fn((req?: { scope?: string; startFrom?: string }) => {
      // Unscoped (pre-filter) loads resolve empty so only the scoped drain is
      // under test.
      if (!req?.scope) return Promise.resolve(pageOf([]));
      const startFrom = req.startFrom;
      const index =
        startFrom === undefined ? 0 : pages.findIndex((_, i) => sealedCursor(i) === startFrom);
      if (index < 0) {
        return Promise.reject(new Error(`400 invalid_cursor: ${JSON.stringify(startFrom)}`));
      }
      return Promise.resolve(pages[index]);
    });
    stub({
      // A folder is what makes the filter row render at all.
      folders: vi.fn().mockResolvedValue(pageOf([{ id: 'f1', name: 'Reports' }])),
      documents: listDocuments,
    });

    renderPage();

    await user.type(await screen.findByRole('textbox', { name: /owner scope/i }), 'org:acme');

    // Both pages render — the row behind the empty page is NOT lost.
    expect(await screen.findByRole('link', { name: 'Scoped Two' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Scoped One' })).toBeInTheDocument();
    // The second request echoed the envelope's cursor verbatim.
    expect(listDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'org:acme', startFrom: sealedCursor(1) }),
    );
  });

  it('scopes the document list server-side by the selected folder', async () => {
    // The mock honors the request folderId — i.e. the server does the scoping,
    // not the client. Selecting a folder must re-query with that folderId.
    const ALL = [
      { id: 'doc_1', title: 'In Reports', folderId: 'f1' },
      { id: 'doc_2', title: 'In Invoices', folderId: 'f2' },
    ];
    const listDocuments = vi.fn((req?: { folderId?: string }) =>
      Promise.resolve(pageOf(req?.folderId ? ALL.filter((d) => d.folderId === req.folderId) : ALL)),
    );
    stub({
      folders: vi.fn().mockResolvedValue(pageOf([
        { id: 'f1', name: 'Reports' },
        { id: 'f2', name: 'Invoices' },
      ])),
      documents: listDocuments,
    });

    renderPage();

    // Initial "All" load shows both (listDocuments called with no folderId).
    expect(await screen.findByRole('link', { name: 'In Reports' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'In Invoices' })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: /folder/i }));
    await user.click(await screen.findByRole('option', { name: 'Invoices' }));

    // The server is asked for that folder; only its document comes back.
    await vi.waitFor(() =>
      expect(listDocuments).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'f2' })),
    );
    expect(await screen.findByRole('link', { name: 'In Invoices' })).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(screen.queryByRole('link', { name: 'In Reports' })).not.toBeInTheDocument(),
    );
  });

  // A document-surface type with schema-declared payload fields + two documents
  // (one of the type, one schemaless) — the by-type view fixtures.
  const DECISION_SCHEMA = {
    id: 's_dec',
    typeName: 'decision',
    displayName: 'Decision',
    allowedSurfaces: ['record', 'document'],
    fields: [
      { fieldId: 'summary', fieldType: 'string' },
      { fieldId: 'status', fieldType: 'string', filterable: true },
    ],
  };
  const TYPED_DOCS = [
    {
      id: 'doc_dec',
      title: 'decision-note-1.md',
      status: 'ACTIVE',
      indexStatus: 'INDEXED',
      schemaId: 's_dec',
      payload: { summary: 'Use DDB', status: 'accepted' },
    },
    { id: 'doc_free', title: 'scratch.txt', status: 'ACTIVE', indexStatus: 'INDEXED' },
  ];

  it('resolves the Type column from the document schema in the all-types view', async () => {
    stub({
      schemas: vi.fn().mockResolvedValue(pageOf([DECISION_SCHEMA])),
      documents: vi.fn().mockResolvedValue(pageOf(TYPED_DOCS)),
    });
    renderPage();

    const table = await screen.findByRole('table', { name: /documents/i });
    // The typed document shows its typeName; the schemaless one dashes.
    const typedRow = within(table).getByRole('link', { name: 'decision-note-1.md' }).closest('tr');
    expect(typedRow).toHaveTextContent('decision');
  });

  it('filters to a type and shows its schema-derived payload columns', async () => {
    const user = userEvent.setup();
    stub({
      schemas: vi.fn().mockResolvedValue(pageOf([DECISION_SCHEMA])),
      documents: vi.fn().mockResolvedValue(pageOf(TYPED_DOCS)),
    });
    renderPage();

    await screen.findByRole('link', { name: 'decision-note-1.md' });
    await user.click(screen.getByRole('combobox', { name: /document type/i }));
    await user.click(await screen.findByRole('option', { name: 'Decision' }));

    // The type selection lands in the URL (survives detail round-trips).
    expect(screen.getByTestId('location')).toHaveTextContent('/?type=decision');

    // Schema-derived payload columns render with the document's values...
    const table = await screen.findByRole('table', { name: /documents/i });
    expect(within(table).getByText('summary')).toBeInTheDocument();
    expect(within(table).getByText('Use DDB')).toBeInTheDocument();
    expect(within(table).getByText('accepted')).toBeInTheDocument();
    // ...and documents of other/no type drop out of the list.
    expect(within(table).queryByRole('link', { name: 'scratch.txt' })).not.toBeInTheDocument();
  });

  it('shows documents under EITHER schema of a base+variant pair sharing one typeName (not just the resolved one)', async () => {
    const user = userEvent.setup();
    // A lineage base plus the caller's own `basedOn` variant, both typeName
    // "decision" — documents exist under BOTH schema ids.
    const BASE = { id: 's_base', typeName: 'decision', allowedSurfaces: ['document'], fields: [] };
    const VARIANT = {
      id: 's_variant',
      basedOn: 's_base',
      typeName: 'decision',
      allowedSurfaces: ['document'],
      fields: [{ fieldId: 'risk', fieldType: 'string' }],
    };
    const listSchemas = vi.fn((req?: { recordType?: string }) =>
      req?.recordType === 'decision'
        ? Promise.resolve(pageOf([VARIANT])) // the API's own ownership-shadowing resolution
        : Promise.resolve(pageOf([BASE, VARIANT])),
    );
    stub({
      schemas: listSchemas,
      documents: vi.fn().mockResolvedValue(
        pageOf([
          { id: 'doc_base', title: 'base-doc.md', status: 'ACTIVE', schemaId: 's_base' },
          { id: 'doc_variant', title: 'variant-doc.md', status: 'ACTIVE', schemaId: 's_variant' },
        ]),
      ),
    });
    renderPage();

    await screen.findByRole('link', { name: 'base-doc.md' });
    await user.click(screen.getByRole('combobox', { name: /document type/i }));
    // Exactly one "decision" option — no duplicate-key collision.
    expect(await screen.findAllByRole('option', { name: 'decision' })).toHaveLength(1);
    await user.click(screen.getByRole('option', { name: 'decision' }));

    // BOTH documents stay visible — filtering by typeName, not by the single
    // resolved schema id, which would otherwise silently drop one of them.
    const table = await screen.findByRole('table', { name: /documents/i });
    expect(within(table).getByRole('link', { name: 'base-doc.md' })).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'variant-doc.md' })).toBeInTheDocument();
  });

  it('filters typed documents by their filterable payload fields', async () => {
    const user = userEvent.setup();
    const second = {
      id: 'doc_dec2',
      title: 'decision-note-2.md',
      status: 'ACTIVE',
      indexStatus: 'INDEXED',
      schemaId: 's_dec',
      payload: { summary: 'Use SQS', status: 'proposed' },
    };
    stub({
      schemas: vi.fn().mockResolvedValue(pageOf([DECISION_SCHEMA])),
      documents: vi.fn().mockResolvedValue(pageOf([...TYPED_DOCS, second])),
    });
    renderPage();

    await screen.findByRole('link', { name: 'decision-note-1.md' });
    await user.click(screen.getByRole('combobox', { name: /document type/i }));
    await user.click(await screen.findByRole('option', { name: 'Decision' }));

    // `status` is the schema's filterable field — narrow to the proposed one.
    await user.type(screen.getByRole('textbox', { name: /filter documents/i }), 'proposed');
    expect(await screen.findByRole('link', { name: 'decision-note-2.md' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'decision-note-1.md' })).not.toBeInTheDocument();

    // A no-match query shows the filter empty state, not the generic one.
    await user.clear(screen.getByRole('textbox', { name: /filter documents/i }));
    await user.type(screen.getByRole('textbox', { name: /filter documents/i }), 'zzz');
    expect(await screen.findByText(/no documents match the filter/i)).toBeInTheDocument();
  });

  it('sorts the typed view by a payload column header click', async () => {
    const user = userEvent.setup();
    const second = {
      id: 'doc_dec2',
      title: 'decision-note-2.md',
      status: 'ACTIVE',
      indexStatus: 'INDEXED',
      schemaId: 's_dec',
      payload: { summary: 'Alpha first', status: 'proposed' },
    };
    stub({
      schemas: vi.fn().mockResolvedValue(pageOf([DECISION_SCHEMA])),
      documents: vi.fn().mockResolvedValue(pageOf([...TYPED_DOCS, second])),
    });
    renderPage();

    await screen.findByRole('link', { name: 'decision-note-1.md' });
    await user.click(screen.getByRole('combobox', { name: /document type/i }));
    await user.click(await screen.findByRole('option', { name: 'Decision' }));
    await screen.findByText('Use DDB');

    // Ascending sort on the `summary` payload column: 'Alpha first' < 'Use DDB'.
    await user.click(screen.getByRole('button', { name: 'summary' }));
    const rows = screen.getAllByRole('link', { name: /decision-note-\d\.md/ });
    expect(rows.map((r) => r.textContent)).toEqual(['decision-note-2.md', 'decision-note-1.md']);

    // Toggling flips the direction.
    await user.click(screen.getByRole('button', { name: 'summary' }));
    const flipped = screen.getAllByRole('link', { name: /decision-note-\d\.md/ });
    expect(flipped.map((r) => r.textContent)).toEqual(['decision-note-1.md', 'decision-note-2.md']);
  });

  it('runs a server-side lookup in the typed view (externalId is always offered)', async () => {
    const user = userEvent.setup();
    const lookupDocumentsByBody = vi.fn().mockResolvedValue(
      pageOf([
        {
          id: 'doc_dec',
          title: 'decision-note-1.md',
          status: 'ACTIVE',
          indexStatus: 'INDEXED',
          schemaId: 's_dec',
          externalId: 'dec-1',
          payload: { summary: 'Use DDB' },
        },
      ]),
    );
    stub({
      folders: vi.fn().mockResolvedValue(pageOf([{ id: 'f1', name: 'Reports' }])),
      schemas: vi.fn().mockResolvedValue(pageOf([DECISION_SCHEMA])),
      documents: vi.fn().mockResolvedValue(pageOf(TYPED_DOCS)),
      lookupDocumentsByBody,
    });
    renderPage(['/?type=decision']);

    // DECISION_SCHEMA declares no lookupFields — externalId is offered anyway
    // (the identity key needs no schema declaration).
    await user.click(await screen.findByRole('combobox', { name: /look up by/i }));
    await user.click(await screen.findByRole('option', { name: 'externalId' }));
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'dec-1');
    await user.click(screen.getByRole('button', { name: 'Look up' }));

    // The POST-body lookup carries the type + field + exact value + order.
    await waitFor(() =>
      expect(lookupDocumentsByBody).toHaveBeenCalledWith({
        type: 'decision',
        field: 'externalId',
        value: 'dec-1',
        order: 'asc',
        limit: 100,
      }),
    );
    expect(await screen.findByRole('link', { name: 'decision-note-1.md' })).toBeInTheDocument();

    // A lookup runs context-wide — the folder filter doesn't apply and says so.
    const folderSelect = screen.getByRole('combobox', { name: /folder/i });
    expect(folderSelect).toHaveAttribute('aria-disabled', 'true');

    // Clearing the lookup returns to the plain (folder-scoped) list.
    await user.click(screen.getByRole('button', { name: 'Clear lookup' }));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /folder/i })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    );
  });

  // The sort window (`sortFrom`/`sortTo`) narrows an exact match by the lookup
  // field's SORT key. `DocumentLookupRequest` has accepted the pair since the
  // API added it; this page withheld the opt-in on the mistaken premise that
  // the documents endpoint had no such field, so the bounds could not be
  // reached from the UI at all. This asserts they now reach the wire.
  it('narrows a documents lookup by the sort window, and omits an empty bound', async () => {
    const user = userEvent.setup();
    const lookupDocumentsByBody = vi.fn().mockResolvedValue(pageOf([]));
    stub({
      folders: vi.fn().mockResolvedValue(pageOf([{ id: 'f1', name: 'Reports' }])),
      schemas: vi.fn().mockResolvedValue(pageOf([DECISION_SCHEMA])),
      documents: vi.fn().mockResolvedValue(pageOf(TYPED_DOCS)),
      lookupDocumentsByBody,
    });
    renderPage(['/?type=decision']);

    await user.click(await screen.findByRole('combobox', { name: /look up by/i }));
    await user.click(await screen.findByRole('option', { name: 'externalId' }));
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'dec-1');

    // Offered at all — the regression this guards is the window silently not
    // rendering because the page stopped opting in.
    await user.type(screen.getByRole('textbox', { name: 'Sort from' }), '1700000000000');
    await user.click(screen.getByRole('button', { name: 'Look up' }));

    // `sortFrom` rides the body; `sortTo` is ABSENT, not `undefined` — the app
    // compiles with `exactOptionalPropertyTypes` and the SDK omits empty keys.
    await waitFor(() =>
      expect(lookupDocumentsByBody).toHaveBeenCalledWith({
        type: 'decision',
        field: 'externalId',
        value: 'dec-1',
        sortFrom: '1700000000000',
        order: 'asc',
        limit: 100,
      }),
    );
    expect(Object.keys(lookupDocumentsByBody.mock.calls[0]?.[0] ?? {})).not.toContain('sortTo');
  });

  // Guards the units gate. The panel hides the sort window when the lookup's
  // sort key is a declared field, whose value space it cannot interpret — the
  // bounds are documented as epoch millis only for the createdAt/lastUpdated
  // default. That gate reads `sortBy` off the field def, so this page must pass
  // it through; when it did not, every exact lookup got the window, including
  // this one, and a user's epoch-millis bound would have ranged over `priority`.
  it('hides the sort window for a lookup sorted by a declared field, whose units it cannot interpret', async () => {
    const user = userEvent.setup();
    stub({
      folders: vi.fn().mockResolvedValue(pageOf([])),
      schemas: vi.fn().mockResolvedValue(
        pageOf([
          {
            ...DECISION_SCHEMA,
            lookupFields: [{ fieldName: 'caseId', sortBy: 'priority' }],
          },
        ]),
      ),
      documents: vi.fn().mockResolvedValue(pageOf(TYPED_DOCS)),
    });
    renderPage(['/?type=decision']);

    await user.click(await screen.findByRole('combobox', { name: /look up by/i }));
    await user.click(await screen.findByRole('option', { name: 'caseId' }));
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'c-1');

    expect(screen.queryByRole('textbox', { name: 'Sort from' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Sort to' })).not.toBeInTheDocument();

    // Control: externalId declares no sortBy, so it defaults to createdAt and
    // DOES offer the window — proving the assertion above is about `sortBy`,
    // not about the opt-in having been silently lost.
    await user.click(screen.getByRole('combobox', { name: /look up by/i }));
    await user.click(await screen.findByRole('option', { name: 'externalId' }));
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'dec-1');
    expect(screen.getByRole('textbox', { name: 'Sort from' })).toBeInTheDocument();
  });

  it('carries both sort bounds when both are given', async () => {
    const user = userEvent.setup();
    const lookupDocumentsByBody = vi.fn().mockResolvedValue(pageOf([]));
    stub({
      folders: vi.fn().mockResolvedValue(pageOf([])),
      schemas: vi.fn().mockResolvedValue(pageOf([DECISION_SCHEMA])),
      documents: vi.fn().mockResolvedValue(pageOf(TYPED_DOCS)),
      lookupDocumentsByBody,
    });
    renderPage(['/?type=decision']);

    await user.click(await screen.findByRole('combobox', { name: /look up by/i }));
    await user.click(await screen.findByRole('option', { name: 'externalId' }));
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'dec-1');
    await user.type(screen.getByRole('textbox', { name: 'Sort from' }), '1700000000000');
    await user.type(screen.getByRole('textbox', { name: 'Sort to' }), '1800000000000');
    await user.click(screen.getByRole('button', { name: 'Look up' }));

    await waitFor(() =>
      expect(lookupDocumentsByBody).toHaveBeenCalledWith({
        type: 'decision',
        field: 'externalId',
        value: 'dec-1',
        sortFrom: '1700000000000',
        sortTo: '1800000000000',
        order: 'asc',
        limit: 100,
      }),
    );
  });

  // The owner-scope box on THIS page is single-dimension: the documents LIST
  // endpoint takes only `scope`. A comma-separated value must therefore be
  // refused in the box rather than silently dropped, which would widen the
  // result set with no visible cause.
  it('flags a multi-dimension owner scope and sends no scope at all', async () => {
    const user = userEvent.setup();
    const documents = vi.fn().mockResolvedValue(pageOf(TYPED_DOCS));
    // A folder is what makes the filter row render at all.
    stub({
      folders: vi.fn().mockResolvedValue(pageOf([{ id: 'f1', name: 'Reports' }])),
      documents,
    });
    renderPage();

    await user.type(
      await screen.findByRole('textbox', { name: /owner scope/i }),
      'org:acme, client:pilot',
    );

    expect(screen.getByText(/use namespace:value, e\.g\./i)).toBeInTheDocument();

    // The invariant is about what reaches the WIRE, asserted over every call.
    // Not the last call: the box filters live, so the prefix `org:acme` is
    // legitimately valid part-way through typing and fires its own request;
    // once the value goes invalid the key reverts to the unscoped one, which
    // react-query serves from cache — so no NEW call marks the settled state.
    // What must never happen is the comma-separated value reaching this
    // endpoint, which has no `scopeFilters` and would read it as one long
    // value or refuse it outright.
    await waitFor(() => expect(documents).toHaveBeenCalled());
    expect(
      documents.mock.calls.every(
        ([arg]) => !((arg as { scope?: string })?.scope ?? '').includes(','),
      ),
    ).toBe(true);
  });

  it('never offers a composite lookup field, even if one somehow appears on a document-viewable schema', async () => {
    // A composite is structurally record-only (the server refuses one unless
    // allowedSurfaces is EXACTLY ['record']), so this schema could never
    // really carry one — this pins the defensive filter that keeps the
    // documents picker correct even if that invariant were ever violated.
    const user = userEvent.setup();
    stub({
      schemas: vi.fn().mockResolvedValue(
        pageOf([{ ...DECISION_SCHEMA, lookupFields: [{ fieldNames: ['status', 'summary'] }] }]),
      ),
      documents: vi.fn().mockResolvedValue(pageOf(TYPED_DOCS)),
    });
    renderPage(['/?type=decision']);

    await user.click(await screen.findByRole('combobox', { name: /look up by/i }));
    expect(await screen.findByRole('option', { name: 'externalId' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'status,summary' })).not.toBeInTheDocument();
  });

  it('shows the lookup no-match state when a lookup returns nothing', async () => {
    const user = userEvent.setup();
    stub({
      schemas: vi.fn().mockResolvedValue(pageOf([DECISION_SCHEMA])),
      documents: vi.fn().mockResolvedValue(pageOf(TYPED_DOCS)),
      lookupDocumentsByBody: vi.fn().mockResolvedValue(pageOf([])),
    });
    renderPage(['/?type=decision']);

    await user.click(await screen.findByRole('combobox', { name: /look up by/i }));
    await user.click(await screen.findByRole('option', { name: 'externalId' }));
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'nope');
    await user.click(screen.getByRole('button', { name: 'Look up' }));

    expect(await screen.findByText(/no documents match this lookup/i)).toBeInTheDocument();
  });

  it('degrades a stale ?type= URL to the all-types view', async () => {
    stub({
      schemas: vi.fn().mockResolvedValue(pageOf([DECISION_SCHEMA])),
      documents: vi.fn().mockResolvedValue(pageOf(TYPED_DOCS)),
    });
    renderPage(['/?type=no_such_type']);

    // Both documents render (no type filter applied) and the Select shows All.
    expect(await screen.findByRole('link', { name: 'decision-note-1.md' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'scratch.txt' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /document type/i })).toHaveTextContent(
      'All types',
    );
  });

  it('shows the type-scoped empty state when the type has no documents', async () => {
    const user = userEvent.setup();
    stub({
      schemas: vi.fn().mockResolvedValue(pageOf([DECISION_SCHEMA])),
      documents: vi.fn().mockResolvedValue(pageOf([{ id: 'doc_free', title: 'scratch.txt' }])),
    });
    renderPage();

    await screen.findByRole('link', { name: 'scratch.txt' });
    await user.click(screen.getByRole('combobox', { name: /document type/i }));
    await user.click(await screen.findByRole('option', { name: 'Decision' }));

    expect(await screen.findByText(/no documents of this type/i)).toBeInTheDocument();
  });

  it('shows an empty state when the context has no documents', async () => {
    stub({ documents: vi.fn().mockResolvedValue(pageOf([])) });
    renderPage();
    expect(await screen.findByText(/no documents yet/i)).toBeInTheDocument();
  });

  it('shows an error state when documents fail to load', async () => {
    stub({ documents: vi.fn().mockRejectedValue(new Error('boom')) });
    renderPage();
    expect(await screen.findByText(/couldn.t load documents/i)).toBeInTheDocument();
  });

  it('creates a folder via the New folder dialog', async () => {
    const user = userEvent.setup();
    const createFolder = vi.fn().mockResolvedValue({ id: 'f_new', name: 'Reports' });
    stub({ createFolder });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'New folder' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/folder name/i), 'Reports');
    await user.click(within(dialog).getByRole('button', { name: 'Create folder' }));

    // The request body nests under `body` (SDK 0.31 un-inlined it when `?upsert` was added).
    await vi.waitFor(() => expect(createFolder).toHaveBeenCalledWith({ body: { name: 'Reports' } }));
  });

  it('deletes a folder after confirmation', async () => {
    const user = userEvent.setup();
    const deleteFolder = vi.fn().mockResolvedValue(undefined);
    stub({ folders: vi.fn().mockResolvedValue(pageOf([{ id: 'f1', name: 'Reports' }])), deleteFolder });
    renderPage();

    // The folder-management card renders a delete action for the (unprotected) folder.
    await user.click(await screen.findByRole('button', { name: /delete the reports folder/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete folder' }));

    await vi.waitFor(() => expect(deleteFolder).toHaveBeenCalledWith({ id: 'f1' }));
  });

  it('warns in the confirm body when the folder is not empty', async () => {
    const user = userEvent.setup();
    stub({
      folders: vi.fn().mockResolvedValue(pageOf([{ id: 'f1', name: 'Reports' }])),
      documents: vi
        .fn()
        .mockResolvedValue(pageOf([
          { id: 'd1', title: 'In Reports', folderId: 'f1', status: 'ACTIVE', indexStatus: 'INDEXED' },
        ])),
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /delete the reports folder/i }));
    const dialog = await screen.findByRole('dialog');
    // The folder visibly contains a document → pre-emptive non-empty warning.
    expect(within(dialog).getByText(/isn't empty/i)).toBeInTheDocument();
  });

  it('hides the non-empty warning for a folder outside the current scope (best-effort)', async () => {
    const user = userEvent.setup();
    // f1 (Reports) holds a doc; the f1-scoped list can't see f2 (Invoices)'s
    // contents, so the doc-visibility gate must suppress the (uncertain) warning.
    const listDocuments = vi.fn((req?: { folderId?: string }) =>
      Promise.resolve(
        pageOf(
          req?.folderId === 'f1'
            ? [{ id: 'd1', title: 'In Reports', folderId: 'f1', status: 'ACTIVE', indexStatus: 'INDEXED' }]
            : [],
        ),
      ),
    );
    stub({
      // Reports (f1) is protected → no delete button, so the only deletable
      // folder is Invoices (f2); keeps the delete-button query unambiguous.
      folders: vi.fn().mockResolvedValue(pageOf([
        { id: 'f1', name: 'Reports', isProtected: true },
        { id: 'f2', name: 'Invoices' },
      ])),
      documents: listDocuments,
    });
    renderPage();

    // Scope the list to Reports (f1).
    await user.click(await screen.findByRole('combobox', { name: /folder/i }));
    await user.click(await screen.findByRole('option', { name: 'Reports' }));
    await vi.waitFor(() =>
      expect(listDocuments).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'f1' })),
    );

    // Open delete on Invoices (f2) — outside the current scope.
    await user.click(screen.getByRole('button', { name: /delete the invoices folder/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Invoices'); // confirm we targeted f2
    // Doc-visibility gate suppresses the uncertain warning; backend 400 still guards.
    expect(within(dialog).queryByText(/isn't empty/i)).not.toBeInTheDocument();
  });

  it('shows a specific not-empty message when folder-delete fails with 400', async () => {
    const user = userEvent.setup();
    const deleteFolder = vi.fn().mockRejectedValue({ statusCode: 400 });
    stub({ folders: vi.fn().mockResolvedValue(pageOf([{ id: 'f1', name: 'Reports' }])), deleteFolder });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /delete the reports folder/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete folder' }));

    // A 400 is the non-empty case — show the actionable copy, not generic retry.
    expect(await within(dialog).findByText(/still contains items/i)).toBeInTheDocument();
  });

  it('resets the folder filter to All when the filtered folder is deleted', async () => {
    const user = userEvent.setup();
    const deleteFolder = vi.fn().mockResolvedValue(undefined);
    stub({ folders: vi.fn().mockResolvedValue(pageOf([{ id: 'f1', name: 'Reports' }])), deleteFolder });
    renderPage();

    // Filter to the Reports folder...
    await user.click(await screen.findByRole('combobox', { name: /folder/i }));
    await user.click(await screen.findByRole('option', { name: 'Reports' }));
    expect(screen.getByRole('combobox', { name: /folder/i })).toHaveTextContent('Reports');

    // ...then delete it; the filter falls back to All (no stranded empty view).
    await user.click(screen.getByRole('button', { name: /delete the reports folder/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete folder' }));

    await vi.waitFor(() =>
      expect(screen.getByRole('combobox', { name: /folder/i })).toHaveTextContent('All folders'),
    );
  });

  it('hides edit/delete for a protected folder', async () => {
    stub({ folders: vi.fn().mockResolvedValue(pageOf([{ id: 'root', name: 'Root', isProtected: true }])) });
    renderPage();
    expect(await screen.findByText('Protected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete folder' })).not.toBeInTheDocument();
  });

  it('ingests a text document via the Add document dialog', async () => {
    const user = userEvent.setup();
    const ingestDocument = vi.fn().mockResolvedValue({ id: 'doc_new' });
    stub({ ingestDocument });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Add document' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Ingest text' })); // mode toggle
    await user.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Notes');
    await user.type(within(dialog).getByRole('textbox', { name: /text content/i }), 'hello world');
    await user.click(within(dialog).getByRole('button', { name: 'Ingest' })); // submit

    await vi.waitFor(() =>
      expect(ingestDocument).toHaveBeenCalledWith(
        // The request body nests under `body` (SDK 0.31 un-inlined it when `?upsert` was added).
        expect.objectContaining({
          body: expect.objectContaining({ title: 'Notes', text: 'hello world', indexMode: 'HYBRID' }),
        }),
      ),
    );
  });

  it('opens the Ask-this-document drawer from a per-row action, scoped to that document', async () => {
    const user = userEvent.setup();
    const documentAsk = vi.fn(() => Promise.resolve(emptyStream()));
    stub({
      documents: vi
        .fn()
        .mockResolvedValue(
          pageOf([{ id: 'doc_1', title: 'Q1 Report', status: 'ACTIVE', indexStatus: 'INDEXED' }]),
        ),
      documentAsk,
    });
    renderPage();

    // The row exposes an "Ask this document" action scoped to that document.
    await user.click(await screen.findByRole('button', { name: /ask a question about q1 report/i }));

    // The drawer opens (its heading + document-scoped ask affordance show).
    expect(await screen.findByRole('heading', { name: 'Ask this document' })).toBeInTheDocument();
    const prompt = screen.getByPlaceholderText(/ask a question about this document/i);

    // Submitting pins the request to THIS document's id (doc_1), proving the
    // row action wired the right document into the drawer.
    await user.type(prompt, 'What is the revenue?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await vi.waitFor(() =>
      expect(documentAsk).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'doc_1', prompt: 'What is the revenue?' }),
        expect.anything(),
      ),
    );
  });

  it('deep-links "Ask this folder" to /ai/ask with the folderId scope', async () => {
    const user = userEvent.setup();
    stub({ folders: vi.fn().mockResolvedValue(pageOf([{ id: 'f1', name: 'Reports' }])) });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /ask a question scoped to the reports folder/i }));

    expect(screen.getByTestId('location')).toHaveTextContent('/ai/ask?folderId=f1');
  });

  it('uploads a file via the presigned URL', async () => {
    const user = userEvent.setup();
    const uploadDocument = vi
      .fn()
      .mockResolvedValue({ id: 'doc_up', uploadUrl: 'https://s3.example/put' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    try {
      stub({ uploadDocument });
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Add document' }));
      const dialog = await screen.findByRole('dialog');
      const file = new File(['hi'], 'note.txt', { type: 'text/plain' });
      await user.upload(within(dialog).getByLabelText('File'), file);
      await user.click(within(dialog).getByRole('button', { name: 'Upload' }));

      await vi.waitFor(() =>
        expect(uploadDocument).toHaveBeenCalledWith({
          fileName: 'note.txt',
          fileType: 'text/plain',
          indexMode: 'HYBRID',
          storeText: true,
        }),
      );
      // The raw bytes are PUT to the presigned URL (no Authorization header).
      expect(fetchMock).toHaveBeenCalledWith(
        'https://s3.example/put',
        expect.objectContaining({ method: 'PUT' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
