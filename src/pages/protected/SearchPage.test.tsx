// ---------------------------------------------------------------------------
// SearchPage tests — query → unified results, with the SDK mocked. Covers the
// result cards (title/similarity/links), the ranking-mode toggle, the
// source/folder/type filters, offset pagination, and the degraded warning.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
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

function renderPage(opts: { staleTime?: number } = {}): void {
  render(
    <TestProviders staleTime={opts.staleTime}>
      <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
        <CurrentContextProvider
          initialContexts={[
            { contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' },
          ]}
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

  it('surfaces a failed folder drain instead of silently dropping the folder filter', async () => {
    // Falling back to an empty folder list hides the filter entirely, which
    // reads as "this context has no folders" — so the results look unfiltered
    // by choice when the filter was never offered.
    stub({ folders: vi.fn().mockRejectedValue(new Error('400 invalid_cursor')) });

    renderPage();

    expect(await screen.findByText(/couldn't load this context's folders/i)).toBeInTheDocument();
    // Documents the consequence rather than guarding it: the pre-existing
    // `folders.length > 0` gate hides the picker on an empty list too, so this
    // holds with or without the fix. The `findByText` is what has the power.
    expect(screen.queryByRole('combobox', { name: /folder/i })).not.toBeInTheDocument();
  });

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

  describe('the owner scope is applied only once it settles', () => {
    // Every search is billed; typing `org:acme` passes through several valid
    // entries (`org:a`, `org:ac`, ...) that must not each fire a search.
    it('typing an owner scope after a search runs exactly one search, for the settled value', async () => {
      const user = userEvent.setup();
      const content = vi.fn().mockResolvedValue({ results: [] });
      stub({ content });
      renderPage();
      await runSearch('hello');
      await waitFor(() => expect(content).toHaveBeenCalledTimes(1));

      await user.type(screen.getByRole('textbox', { name: /owner scope/i }), 'org:acme');
      await waitFor(() => expect(content).toHaveBeenCalledTimes(2), { timeout: 2000 });
      await new Promise((r) => setTimeout(r, 600));

      expect(content).toHaveBeenCalledTimes(2);
      expect(content).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: 'hello', scope: 'org:acme' }),
      );
    });

    it('a settled value equivalent to the applied one fires no search', async () => {
      const user = userEvent.setup();
      const content = vi.fn().mockResolvedValue({ results: [] });
      stub({ content });
      renderPage();
      const box = screen.getByRole('textbox', { name: /owner scope/i });
      await user.type(box, 'org:acme');
      await runSearch('hello');
      await waitFor(() => expect(content).toHaveBeenCalledTimes(1));

      // Delete the last character and retype it before the value settles, then
      // add a trailing separator that parses to the same single entry.
      await user.type(box, '{Backspace}e,');
      await new Promise((r) => setTimeout(r, 800));
      expect(content).toHaveBeenCalledTimes(1);
    });

    it('Search applies a just-typed owner scope at once, without first searching with the old one', async () => {
      const user = userEvent.setup();
      const content = vi.fn().mockResolvedValue({ results: [] });
      stub({ content });
      renderPage();
      await user.type(screen.getByRole('textbox', { name: /owner scope/i }), 'org:acme');
      await runSearch('hello');
      await new Promise((r) => setTimeout(r, 600));

      expect(content).toHaveBeenCalledTimes(1);
      expect(content).toHaveBeenCalledWith(expect.objectContaining({ query: 'hello', scope: 'org:acme' }));
    });
  });

  // `/v1/search` narrows by more than one ownership dimension via `scopeFilters`
  // (SDK 0.43.0). It is MUTUALLY EXCLUSIVE with `scope` — sending both is a 400 —
  // so the two-dimension case must send `scopeFilters` and no `scope` at all.
  it('sends two owner dimensions as `scopeFilters`, and never alongside `scope`', async () => {
    const user = userEvent.setup();
    const content = vi.fn().mockResolvedValue({ results: [] });
    stub({ content });
    renderPage();
    await user.type(
      screen.getByRole('textbox', { name: /owner scope/i }),
      'org:acme, client:pilot',
    );
    await runSearch('hello');

    await vi.waitFor(() =>
      expect(content).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: 'hello',
          scopeFilters: ['org:acme', 'client:pilot'],
        }),
      ),
    );
    const last = content.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(Object.keys(last)).not.toContain('scope');
  });

  // Each namespace may be named at most once — the API rejects a repeat, so the
  // box must not fire the request at all.
  it('never sends a filter naming one namespace twice', async () => {
    const user = userEvent.setup();
    const content = vi.fn().mockResolvedValue({ results: [] });
    stub({ content });
    renderPage();
    await user.type(screen.getByRole('textbox', { name: /owner scope/i }), 'org:a, org:b');
    await runSearch('hello');

    await vi.waitFor(() => expect(content).toHaveBeenCalled());
    expect(
      content.mock.calls.every(([arg]) => {
        const a = arg as Record<string, unknown>;
        return a['scopeFilters'] === undefined && a['scope'] === undefined;
      }),
    ).toBe(true);
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

  // `createdAt` on a search HIT is when the item entered the search index, not
  // when the source item was created. Rendered bare it reads as the latter, so
  // it carries an "Indexed" label and a tooltip. Without this cell the entire
  // relabel could be reverted and every other SearchPage test would stay green.
  it('labels a hit date as the INDEX time, with a tooltip saying so', async () => {
    const user = userEvent.setup();
    stub({
      content: vi.fn().mockResolvedValue({
        results: [
          {
            documentId: 'doc_1',
            sourceType: 'PartnerDocument',
            createdAt: '2026-03-04T05:06:07.000Z',
          },
        ],
      }),
    });

    renderPage();
    await runSearch('hello');

    const labeled = await screen.findByText(/Indexed\s+Mar\s+4,\s+2026/);
    expect(labeled).toBeInTheDocument();

    await user.hover(labeled);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/entered the search index/i);
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

  describe('re-running a search', () => {
    // The query is keyed on the submitted term, so re-submitting an unchanged
    // term changes no key: without an explicit refetch the cached page is served
    // and no request goes out. Indexing is asynchronous, so a search run just
    // before a new item is indexed would otherwise stay empty indefinitely.

    it('does not offer the refresh control before any search has run', () => {
      stub({});
      renderPage();
      expect(screen.queryByRole('button', { name: /refresh results/i })).not.toBeInTheDocument();
    });

    it('re-submitting the SAME term issues a new request instead of serving the cache', async () => {
      const content = vi
        .fn()
        .mockResolvedValueOnce({ results: [] })
        .mockResolvedValue({
          totalResults: 1,
          results: [{ documentId: 'doc_1', sourceType: 'PartnerDocument', chunkText: 'Now indexed.' }],
        });
      stub({ content });
      renderPage();

      await runSearch('marker');
      expect(await screen.findByText(/no results for/i)).toBeInTheDocument();
      expect(content).toHaveBeenCalledTimes(1);

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /^search$/i }));
      await waitFor(() => expect(content).toHaveBeenCalledTimes(2));
      expect(await screen.findByText('Now indexed.')).toBeInTheDocument();
    });

    it('does not send a duplicate request when the same term is re-submitted while a re-run is in flight', async () => {
      let resolveRerun: (value: unknown) => void = () => {};
      const content = vi
        .fn()
        .mockResolvedValueOnce({
          totalResults: 1,
          results: [{ documentId: 'doc_a', sourceType: 'PartnerDocument', chunkText: 'First.' }],
        })
        .mockImplementationOnce(() => new Promise((resolve) => { resolveRerun = resolve; }))
        .mockResolvedValue({ results: [] });
      stub({ content });
      renderPage();

      await runSearch('marker');
      expect(await screen.findByText('First.')).toBeInTheDocument();

      const user = userEvent.setup();
      const submit = screen.getByRole('button', { name: /^search$/i });
      await user.click(submit); // starts the re-run, which stays in flight
      await waitFor(() => expect(content).toHaveBeenCalledTimes(2));
      await user.click(submit); // must NOT restart it
      await new Promise((r) => setTimeout(r, 50));
      expect(content).toHaveBeenCalledTimes(2);

      resolveRerun({
        totalResults: 1,
        results: [{ documentId: 'doc_b', sourceType: 'PartnerDocument', chunkText: 'Second.' }],
      });
      expect(await screen.findByText('Second.')).toBeInTheDocument();
      expect(content).toHaveBeenCalledTimes(2);
    });

    it('submitting a DIFFERENT term runs that term rather than re-running the old one', async () => {
      const content = vi.fn().mockResolvedValue({ results: [] });
      stub({ content });
      renderPage();

      await runSearch('first');
      await waitFor(() => expect(content).toHaveBeenCalledTimes(1));
      await runSearch('x'); // the box now reads "firstx"
      await waitFor(() => expect(content).toHaveBeenCalledTimes(2));
      expect(content).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'firstx', offset: 0 }));
    });

    it.each([
      ['the refresh control', /refresh results/i],
      ['re-submitting the same term', /^search$/i],
    ])('re-running via %s after "Load more" fetches ONLY the first page, never re-billing every loaded page', async (_trigger, rerunButton) => {
      // A plain refetch() on an infinite query re-issues every loaded page in
      // sequence: here that would be a second, offset-carrying search the caller
      // never asked for, and every search is billed.
      const firstPage = Array.from({ length: 25 }, (_, i) => ({
        documentId: `doc_${i}`,
        sourceType: 'PartnerDocument',
        chunkText: `hit ${i}`,
      }));
      const content = vi
        .fn()
        .mockResolvedValueOnce({ totalResults: 30, results: firstPage })
        .mockResolvedValueOnce({
          totalResults: 30,
          results: [{ documentId: 'doc_25', sourceType: 'PartnerDocument', chunkText: 'page two hit' }],
        })
        .mockResolvedValue({ totalResults: 30, results: firstPage });
      stub({ content });
      renderPage();

      await runSearch('hello');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Load more' }));
      expect(await screen.findByText('page two hit')).toBeInTheDocument();
      expect(content).toHaveBeenCalledTimes(2);

      await user.click(screen.getByRole('button', { name: rerunButton }));
      await waitFor(() => expect(content).toHaveBeenCalledTimes(3));
      expect(content.mock.calls[2]?.[0]).toEqual(expect.objectContaining({ offset: 0 }));
      await waitFor(() => expect(screen.queryByText('page two hit')).not.toBeInTheDocument());
      await new Promise((r) => setTimeout(r, 50));
      expect(content).toHaveBeenCalledTimes(3);
    });

    it('drops a same-term re-submit while "Load more" is in flight, cancelling nothing', async () => {
      // Resetting during a next-page search would cancel a request already sent
      // (and billed) and re-issue page one on top of it.
      const firstPage = Array.from({ length: 25 }, (_, i) => ({
        documentId: `doc_${i}`,
        sourceType: 'PartnerDocument',
        chunkText: `hit ${i}`,
      }));
      let resolvePageTwo: (value: unknown) => void = () => {};
      const content = vi
        .fn()
        .mockResolvedValueOnce({ totalResults: 30, results: firstPage })
        .mockImplementationOnce(() => new Promise((r) => { resolvePageTwo = r; }))
        .mockResolvedValue({ totalResults: 30, results: firstPage });
      stub({ content });
      renderPage();

      await runSearch('hello');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Load more' }));
      await waitFor(() => expect(content).toHaveBeenCalledTimes(2));

      await user.click(screen.getByRole('button', { name: /^search$/i }));
      await new Promise((r) => setTimeout(r, 50));
      expect(content).toHaveBeenCalledTimes(2);

      resolvePageTwo({
        totalResults: 30,
        results: [{ documentId: 'doc_25', sourceType: 'PartnerDocument', chunkText: 'page two hit' }],
      });
      expect(await screen.findByText('page two hit')).toBeInTheDocument();
      expect(content).toHaveBeenCalledTimes(2);
    });

    describe('automatic refetches never re-walk loaded pages', () => {
      // Production data goes stale after a finite time, and react-query's automatic
      // refetches re-fetch every loaded page of an infinite query. `staleTime: 0`
      // reproduces that staleness here.
      const pagedContent = () =>
        vi.fn().mockImplementation(({ query, offset }: { query: string; offset: number }) =>
          Promise.resolve(
            offset === 0
              ? {
                  totalResults: 30,
                  results: Array.from({ length: 25 }, (_, i) => ({
                    documentId: `${query}_${i}`,
                    sourceType: 'PartnerDocument',
                    chunkText: `${query} hit ${i}`,
                  })),
                }
              : {
                  totalResults: 30,
                  results: [{ documentId: `${query}_25`, sourceType: 'PartnerDocument', chunkText: `${query} page two` }],
                },
          ),
        );

      it('returning to an earlier term after Load more runs its first page once', async () => {
        const content = pagedContent();
        stub({ content });
        renderPage({ staleTime: 0 });
        const user = userEvent.setup();
        const box = screen.getByRole('textbox', { name: /search/i });

        await runSearch('alpha');
        await user.click(await screen.findByRole('button', { name: 'Load more' }));
        expect(await screen.findByText('alpha page two')).toBeInTheDocument();

        await user.clear(box);
        await user.type(box, 'beta');
        await user.click(screen.getByRole('button', { name: /^search$/i }));
        expect(await screen.findByText('beta hit 0')).toBeInTheDocument();

        await user.clear(box);
        await user.type(box, 'alpha');
        await user.click(screen.getByRole('button', { name: /^search$/i }));
        expect(await screen.findByText('alpha hit 0')).toBeInTheDocument();
        await new Promise((r) => setTimeout(r, 50));

        // alpha p1, alpha p2, beta p1, then alpha p1 once: never alpha p2 again.
        expect(content.mock.calls.map(([a]) => `${a.query}@${a.offset}`)).toEqual([
          'alpha@0',
          'alpha@25',
          'beta@0',
          'alpha@0',
        ]);
      });

      it('a network reconnect does not refetch a search with several pages loaded', async () => {
        const content = pagedContent();
        stub({ content });
        renderPage({ staleTime: 0 });
        const user = userEvent.setup();

        await runSearch('alpha');
        await user.click(await screen.findByRole('button', { name: 'Load more' }));
        expect(await screen.findByText('alpha page two')).toBeInTheDocument();
        expect(content).toHaveBeenCalledTimes(2);

        try {
          act(() => onlineManager.setOnline(false));
          act(() => onlineManager.setOnline(true));
          await new Promise((r) => setTimeout(r, 50));
          expect(content).toHaveBeenCalledTimes(2);
        } finally {
          onlineManager.setOnline(true);
        }
      });
    });

    it('treats a re-submit differing only by surrounding whitespace as the same search', async () => {
      const content = vi
        .fn()
        .mockResolvedValueOnce({ results: [] })
        .mockResolvedValue({
          totalResults: 1,
          results: [{ documentId: 'doc_2', sourceType: 'PartnerDocument', chunkText: 'Trimmed match.' }],
        });
      stub({ content });
      renderPage();

      await runSearch('marker');
      expect(await screen.findByText(/no results for/i)).toBeInTheDocument();

      // Appending spaces leaves the trimmed term unchanged, so this must take the
      // re-run path, not the key-change path.
      await runSearch('  ');
      await waitFor(() => expect(content).toHaveBeenCalledTimes(2));
      expect(await screen.findByText('Trimmed match.')).toBeInTheDocument();
      expect(content).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'marker' }));
    });

    it('the refresh control re-runs the search from the EMPTY state', async () => {
      const content = vi
        .fn()
        .mockResolvedValueOnce({ results: [] })
        .mockResolvedValue({
          totalResults: 1,
          results: [{ documentId: 'doc_3', sourceType: 'PartnerDocument', chunkText: 'Arrived on retry.' }],
        });
      stub({ content });
      renderPage();

      await runSearch('marker');
      expect(await screen.findByText(/no results for/i)).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /refresh results/i }));
      await waitFor(() => expect(content).toHaveBeenCalledTimes(2));
      expect(await screen.findByText('Arrived on retry.')).toBeInTheDocument();
    });

    it('the refresh control re-runs the search from the ERROR state', async () => {
      const content = vi
        .fn()
        .mockRejectedValueOnce(new Error('upstream failed'))
        .mockResolvedValue({
          totalResults: 1,
          results: [{ documentId: 'doc_4', sourceType: 'PartnerDocument', chunkText: 'Back up.' }],
        });
      stub({ content });
      renderPage();

      await runSearch('marker');
      expect(await screen.findByText(/search failed/i)).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /refresh results/i }));
      expect(await screen.findByText('Back up.')).toBeInTheDocument();
    });

    it('the refresh control re-runs the search alongside a NON-empty result set', async () => {
      // The other cells drive the empty/error states, so neither would notice the
      // control disappearing from the results header.
      const content = vi
        .fn()
        .mockResolvedValueOnce({
          totalResults: 1,
          results: [{ documentId: 'doc_5', sourceType: 'PartnerDocument', chunkText: 'First pass.' }],
        })
        .mockResolvedValue({
          totalResults: 1,
          results: [{ documentId: 'doc_6', sourceType: 'PartnerDocument', chunkText: 'Second pass.' }],
        });
      stub({ content });
      renderPage();

      await runSearch('marker');
      expect(await screen.findByText('First pass.')).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /refresh results/i }));
      await waitFor(() => expect(content).toHaveBeenCalledTimes(2));
      expect(await screen.findByText('Second pass.')).toBeInTheDocument();
    });
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
    stub({
      content,
      schemas: vi.fn().mockResolvedValue(pageOf([{ id: 's1', typeName: 'patient' }])),
    });
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
    stub({
      content,
      schemas: vi.fn().mockResolvedValue(pageOf([{ id: 's1', typeName: 'patient' }])),
    });
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
    stub({
      content,
      schemas: vi.fn().mockResolvedValue(pageOf([{ id: 's1', typeName: 'patient' }])),
    });
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
    stub({
      content,
      schemas: vi.fn().mockResolvedValue(pageOf([{ id: 's1', typeName: 'patient' }])),
    });
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
