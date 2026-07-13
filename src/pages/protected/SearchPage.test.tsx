// ---------------------------------------------------------------------------
// SearchPage tests — query → unified results, with the SDK mocked. Covers the
// result cards (title/similarity/links), the ranking-mode toggle, the
// source/folder/type filters, offset pagination, and the degraded warning.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CurrentTenantProvider } from '@vectros-ai/react';
import type { TenantMembership } from '@vectros-ai/react';

import { SearchPage } from './SearchPage';
import { CurrentContextProvider } from '../../auth/CurrentContextProvider';
import { TestProviders } from '../../test/TestProviders';
import { pageOf } from '../../test/pageOf';

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
  content?: (req: { query: string; offset?: number }) => Promise<unknown>;
  folders?: () => Promise<unknown>;
  schemas?: () => Promise<unknown>;
}): void {
  mockedClient.mockReturnValue({
    search: { content: opts.content ?? vi.fn().mockResolvedValue({ results: [] }) },
    folders: { listFolders: opts.folders ?? vi.fn().mockResolvedValue(pageOf([])) },
    schemas: { listSchemas: opts.schemas ?? vi.fn().mockResolvedValue(pageOf([])) },
  } as never);
}

function renderPage(): void {
  render(
    <TestProviders>
      <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
        <CurrentContextProvider
          initialContexts={[{ contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' }]}
          initialContext="default"
        >
          <SearchPage />
        </CurrentContextProvider>
      </CurrentTenantProvider>
    </TestProviders>,
  );
}

async function runSearch(term: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: /search/i }), term);
  await user.click(screen.getByRole('button', { name: /search/i }));
}

describe('SearchPage', () => {
  beforeEach(() => mockedClient.mockReset());

  it('prompts for a query before any search is run', () => {
    const content = vi.fn();
    stub({ content });
    renderPage();
    expect(screen.getByText(/enter a query/i)).toBeInTheDocument();
    expect(content).not.toHaveBeenCalled();
  });

  it('links each result to its record/document detail (id heading when untitled)', async () => {
    stub({
      content: vi.fn().mockResolvedValue({
        totalResults: 2,
        results: [
          { documentId: 'doc_1', sourceType: 'PartnerDocument', chunkText: 'doc match' },
          { documentId: 'rec_1', sourceType: 'GenericRecord', chunkText: 'record match' },
        ],
      }),
    });

    renderPage();
    await runSearch('hello');

    const docLink = await screen.findByRole('link', { name: 'doc_1' });
    expect(docLink).toHaveAttribute('href', '/documents/doc_1');
    expect(screen.getByRole('link', { name: 'rec_1' })).toHaveAttribute('href', '/records/rec_1');
    expect(screen.getByText('doc match')).toBeInTheDocument();
  });

  it('threads a well-formed owner scope into the search as `scope`', async () => {
    const user = userEvent.setup();
    const content = vi.fn().mockResolvedValue({ results: [] });
    stub({ content });
    renderPage();
    await user.type(screen.getByRole('textbox', { name: /owner scope/i }), 'group:eng');
    await runSearch('hello');

    await vi.waitFor(() =>
      expect(content).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: 'hello', scope: 'group:eng' }),
      ),
    );
    // A malformed owner scope must NOT reach the search call.
    expect(content.mock.calls.every(([arg]) => (arg as { scope?: string }).scope !== 'group')).toBe(
      true,
    );
  });

  it('uses the item title from metadata as the result heading', async () => {
    stub({
      content: vi.fn().mockResolvedValue({
        results: [
          {
            documentId: 'doc_1',
            sourceType: 'PartnerDocument',
            metadata: { title: 'Q1 Financial Report' },
          },
        ],
      }),
    });

    renderPage();
    await runSearch('q1');

    const link = await screen.findByRole('link', { name: 'Q1 Financial Report' });
    expect(link).toHaveAttribute('href', '/documents/doc_1');
  });

  it('shows the semantic similarity for vector-backed results', async () => {
    stub({
      content: vi.fn().mockResolvedValue({
        results: [{ documentId: 'doc_1', sourceType: 'PartnerDocument', semanticScore: 0.92 }],
      }),
    });

    renderPage();
    await runSearch('hello');

    expect(await screen.findByText('92%')).toBeInTheDocument();
  });

  it('shows an empty state when there are no matches', async () => {
    stub({ content: vi.fn().mockResolvedValue({ results: [] }) });
    renderPage();
    await runSearch('nothing');
    expect(await screen.findByText(/no results for/i)).toBeInTheDocument();
  });

  it('shows an error state when the search fails', async () => {
    stub({ content: vi.fn().mockRejectedValue(new Error('boom')) });
    renderPage();
    await runSearch('boom');
    expect(await screen.findByText(/search failed/i)).toBeInTheDocument();
  });

  it('warns when results came back degraded', async () => {
    stub({
      content: vi.fn().mockResolvedValue({
        results: [{ documentId: 'doc_1', sourceType: 'PartnerDocument' }],
        degraded: true,
        degradedLegs: ['vector'],
      }),
    });
    renderPage();
    await runSearch('hello');
    expect(await screen.findByText(/some results may be missing/i)).toBeInTheDocument();
  });

  it('searches all content in HYBRID mode from offset 0 by default', async () => {
    const content = vi.fn().mockResolvedValue({ results: [] });
    stub({ content });
    renderPage();
    await runSearch('hello');
    await vi.waitFor(() => expect(content).toHaveBeenCalled());
    expect(content).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'hello', mode: 'HYBRID', offset: 0 }),
    );
    // "all" scope → no contentTypes key at all (unified search).
    expect(content.mock.calls[0]?.[0]).not.toHaveProperty('contentTypes');
  });

  it('switches the ranking mode to semantic', async () => {
    const user = userEvent.setup();
    const content = vi.fn().mockResolvedValue({ results: [] });
    stub({ content });
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Semantic' }));
    await runSearch('hello');

    await vi.waitFor(() =>
      expect(content).toHaveBeenCalledWith(expect.objectContaining({ mode: 'SEMANTIC' })),
    );
  });

  it('scopes to records when the Records source is chosen', async () => {
    const user = userEvent.setup();
    const content = vi.fn().mockResolvedValue({ results: [] });
    stub({ content });
    renderPage();

    await user.click(screen.getByRole('combobox', { name: /source/i }));
    await user.click(await screen.findByRole('option', { name: 'Records' }));
    await runSearch('hello');

    await vi.waitFor(() =>
      expect(content).toHaveBeenCalledWith(expect.objectContaining({ contentTypes: ['records'] })),
    );
  });

  it('filters by folder', async () => {
    const user = userEvent.setup();
    const content = vi.fn().mockResolvedValue({ results: [] });
    stub({ content, folders: vi.fn().mockResolvedValue(pageOf([{ id: 'f1', name: 'Reports' }])) });
    renderPage();

    await user.click(await screen.findByRole('combobox', { name: 'Folder' }));
    await user.click(await screen.findByRole('option', { name: /Reports/ }));
    await runSearch('hello');

    await vi.waitFor(() =>
      expect(content).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'f1' })),
    );
  });

  it('offers the type filter on the default source and scopes both content types', async () => {
    const user = userEvent.setup();
    const content = vi.fn().mockResolvedValue({ results: [] });
    stub({ content, schemas: vi.fn().mockResolvedValue(pageOf([{ id: 's1', typeName: 'patient' }])) });
    renderPage();

    // SDK 0.30.0: `typeName` scopes documents and records alike, so the type
    // filter is available without first narrowing the source.
    await user.click(await screen.findByRole('combobox', { name: 'Type' }));
    await user.click(await screen.findByRole('option', { name: 'patient' }));
    await runSearch('hello');

    await vi.waitFor(() => expect(content).toHaveBeenCalled());
    const req = content.mock.calls.at(-1)?.[0];
    // "All" source sends no contentTypes — typeName narrows both at once.
    expect(req).toMatchObject({ typeName: 'patient' });
    expect(req).not.toHaveProperty('contentTypes');
  });

  it('scopes the type filter to documents when the source is Documents', async () => {
    const user = userEvent.setup();
    const content = vi.fn().mockResolvedValue({ results: [] });
    stub({ content, schemas: vi.fn().mockResolvedValue(pageOf([{ id: 's1', typeName: 'patient' }])) });
    renderPage();

    await user.click(screen.getByRole('combobox', { name: /source/i }));
    await user.click(await screen.findByRole('option', { name: 'Documents' }));
    await user.click(await screen.findByRole('combobox', { name: 'Type' }));
    await user.click(await screen.findByRole('option', { name: 'patient' }));
    await runSearch('hello');

    await vi.waitFor(() =>
      expect(content).toHaveBeenCalledWith(
        expect.objectContaining({ typeName: 'patient', contentTypes: ['documents'] }),
      ),
    );
  });

  it('scopes the type filter to records when the source is Records', async () => {
    const user = userEvent.setup();
    const content = vi.fn().mockResolvedValue({ results: [] });
    stub({ content, schemas: vi.fn().mockResolvedValue(pageOf([{ id: 's1', typeName: 'patient' }])) });
    renderPage();

    await user.click(screen.getByRole('combobox', { name: /source/i }));
    await user.click(await screen.findByRole('option', { name: 'Records' }));
    await user.click(await screen.findByRole('combobox', { name: 'Type' }));
    await user.click(await screen.findByRole('option', { name: 'patient' }));
    await runSearch('hello');

    await vi.waitFor(() =>
      expect(content).toHaveBeenCalledWith(
        expect.objectContaining({ typeName: 'patient', contentTypes: ['records'] }),
      ),
    );
  });

  it('keeps the selected type when the source changes, re-scoping contentTypes', async () => {
    const user = userEvent.setup();
    const content = vi.fn().mockResolvedValue({ results: [] });
    stub({ content, schemas: vi.fn().mockResolvedValue(pageOf([{ id: 's1', typeName: 'patient' }])) });
    renderPage();

    // Pick a type while the source is Records...
    await user.click(screen.getByRole('combobox', { name: /source/i }));
    await user.click(await screen.findByRole('option', { name: 'Records' }));
    await user.click(await screen.findByRole('combobox', { name: 'Type' }));
    await user.click(await screen.findByRole('option', { name: 'patient' }));
    // ...then switch the source to Documents: the type selection persists and
    // contentTypes follows the new scope (typeName is cross-content in 0.30.0).
    await user.click(screen.getByRole('combobox', { name: /source/i }));
    await user.click(await screen.findByRole('option', { name: 'Documents' }));
    await runSearch('hello');

    await vi.waitFor(() =>
      expect(content).toHaveBeenCalledWith(
        expect.objectContaining({ typeName: 'patient', contentTypes: ['documents'] }),
      ),
    );
  });

  it('loads more results past the first page via offset', async () => {
    const firstPage = Array.from({ length: 25 }, (_, i) => ({
      documentId: `doc_${i}`,
      sourceType: 'PartnerDocument',
    }));
    const content = vi
      .fn()
      .mockResolvedValueOnce({ totalResults: 30, results: firstPage })
      .mockResolvedValueOnce({
        totalResults: 30,
        results: [{ documentId: 'doc_25', sourceType: 'PartnerDocument' }],
      });
    stub({ content });
    renderPage();
    await runSearch('hello');

    const user = userEvent.setup();
    const loadMore = await screen.findByRole('button', { name: 'Load more' });
    await user.click(loadMore);

    await vi.waitFor(() =>
      expect(content).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25 })),
    );
  });
});
