// ---------------------------------------------------------------------------
// AskPage tests — single-shot RAG: streams a grounded answer + non-linked
// citation snippets, with the SDK inference client + model registry mocked.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CurrentTenantProvider } from '@vectros-ai/react';
import type { TenantMembership } from '@vectros-ai/react';

import { AskPage } from './AskPage';
import { CurrentContextProvider } from '../../auth/CurrentContextProvider';
import { TestProviders } from '../../test/TestProviders';
import { pageOf } from '../../test/pageOf';

vi.mock('../../api/vectrosApi', () => ({ vectrosApiClient: vi.fn() }));
import { vectrosApiClient } from '../../api/vectrosApi';

vi.mock('../../hooks/useInferenceModels', () => ({ useInferenceModels: vi.fn() }));
import { useInferenceModels } from '../../hooks/useInferenceModels';

const mockedClient = vi.mocked(vectrosApiClient);
const mockedModels = vi.mocked(useInferenceModels);
const TENANT = 'tnt_0001';

const OWNER: TenantMembership = {
  tenantId: TENANT,
  tenantName: 'Test Org',
  tenantKind: 'test',
  role: 'OWNER',
  status: 'ACTIVE',
  partnerId: 'ptr_0001',
};

/** A RAG stream: search_results → answer deltas → done. */
async function* ragStream(): AsyncGenerator<unknown> {
  yield {
    event: 'search_results',
    results: [{ documentId: 'doc_42', score: 0.91, snippet: 'Relevant passage.' }],
    totalResults: 1,
    searchTimeMs: 17,
  };
  yield { event: 'content_delta', delta: 'Grounded ' };
  yield { event: 'content_delta', delta: 'answer.' };
  yield {
    event: 'done',
    inputTokens: 1,
    outputTokens: 1,
    model: 'haiku',
    platformCreditsCharged: 0,
    inferenceBalanceCentsCharged: 0,
  };
}

function stubRag(
  impl: (req: unknown) => Promise<AsyncIterable<unknown>>,
): ReturnType<typeof vi.fn> {
  const ragInference = vi.fn(impl);
  mockedClient.mockReturnValue({ inference: { ragInference } } as never);
  return ragInference;
}

function renderPage(path = '/ai/ask'): void {
  render(
    <TestProviders initialEntries={[path]}>
      <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
        <CurrentContextProvider
          initialContexts={[{ contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' }]}
          initialContext="default"
        >
          <AskPage />
        </CurrentContextProvider>
      </CurrentTenantProvider>
    </TestProviders>,
  );
}

describe('AskPage', () => {
  beforeEach(() => {
    mockedClient.mockReset();
    mockedModels.mockReset();
    mockedModels.mockReturnValue({
      data: { defaultModel: 'haiku', models: [] },
      isPending: false,
      isError: false,
    } as never);
  });

  it('shows the empty prompt before asking', () => {
    stubRag(() => Promise.resolve(ragStream()));
    renderPage();
    expect(screen.getByText(/grounded in this context/i)).toBeInTheDocument();
  });

  it('streams a grounded answer with non-linked citation snippets', async () => {
    const user = userEvent.setup();
    const ragInference = stubRag(() => Promise.resolve(ragStream()));
    renderPage();

    await user.type(screen.getByRole('textbox', { name: /ask a question/i }), 'What is X?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(screen.getByText('Grounded answer.')).toBeInTheDocument());

    // Citation rendered as a non-linked snippet (id + score), not a link.
    expect(screen.getByText(/Relevant passage\./)).toBeInTheDocument();
    expect(screen.getByText(/doc_42 · 0\.91/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /doc_42/ })).not.toBeInTheDocument();
    expect(screen.getByText(/aren't click-through yet/i)).toBeInTheDocument();

    // The query was forwarded as the RAG request.
    const req = ragInference.mock.calls[0]?.[0] as { query: string };
    expect(req.query).toBe('What is X?');
  });

  it('threads a well-formed owner scope into the RAG retrieval `search.scope`', async () => {
    const user = userEvent.setup();
    const ragInference = stubRag(() => Promise.resolve(ragStream()));
    renderPage();

    await user.type(screen.getByRole('textbox', { name: /owner scope/i }), 'group:eng');
    await user.type(screen.getByRole('textbox', { name: /ask a question/i }), 'Q');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(ragInference).toHaveBeenCalled());
    const req = ragInference.mock.calls[0]?.[0] as { search?: { scope?: string } };
    expect(req.search?.scope).toBe('group:eng');
  });

  it('omits a malformed owner scope from the RAG retrieval', async () => {
    const user = userEvent.setup();
    const ragInference = stubRag(() => Promise.resolve(ragStream()));
    renderPage();

    await user.type(screen.getByRole('textbox', { name: /owner scope/i }), 'group'); // no value
    await user.type(screen.getByRole('textbox', { name: /ask a question/i }), 'Q');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(ragInference).toHaveBeenCalled());
    const req = ragInference.mock.calls[0]?.[0] as { search?: { scope?: string } };
    expect(req.search?.scope).toBeUndefined();
  });

  it('shows a no-sources note when the answer has no citations', async () => {
    const user = userEvent.setup();
    stubRag(() =>
      Promise.resolve(
        (async function* () {
          yield { event: 'search_results', results: [], totalResults: 0, searchTimeMs: 5 };
          yield { event: 'content_delta', delta: 'Answer with no grounding.' };
          yield {
            event: 'done',
            inputTokens: 1,
            outputTokens: 1,
            model: 'haiku',
            platformCreditsCharged: 0,
            inferenceBalanceCentsCharged: 0,
          };
        })(),
      ),
    );
    renderPage();
    await user.type(screen.getByRole('textbox', { name: /ask a question/i }), 'Q');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(screen.getByText(/no sources were retrieved/i)).toBeInTheDocument());
  });

  it('shows a truncation notice when sources were trimmed', async () => {
    const user = userEvent.setup();
    stubRag(() =>
      Promise.resolve(
        (async function* () {
          yield {
            event: 'truncation_warning',
            resultsRequested: 10,
            resultsUsed: 6,
            reason: 'context_window_budget',
          };
          yield { event: 'content_delta', delta: 'Answer.' };
          yield {
            event: 'done',
            inputTokens: 1,
            outputTokens: 1,
            model: 'haiku',
            platformCreditsCharged: 0,
            inferenceBalanceCentsCharged: 0,
          };
        })(),
      ),
    );
    renderPage();
    await user.type(screen.getByRole('textbox', { name: /ask a question/i }), 'Q');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() =>
      expect(screen.getByText(/trimmed to fit the context window/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/6 of 10 used/i)).toBeInTheDocument();
  });

  it('surfaces a RAG error', async () => {
    const user = userEvent.setup();
    stubRag(() =>
      Promise.resolve(
        (async function* () {
          yield { event: 'error', message: 'boom', code: 'rag_error' };
        })(),
      ),
    );
    renderPage();

    await user.type(screen.getByRole('textbox', { name: /ask a question/i }), 'Q');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(screen.getByText(/couldn't answer/i)).toBeInTheDocument());
  });

  it('preserves the partial answer and surfaces the error detail on a mid-stream error', async () => {
    const user = userEvent.setup();
    stubRag(() =>
      Promise.resolve(
        (async function* () {
          yield { event: 'content_delta', delta: 'Partial grounded text' };
          yield { event: 'error', message: 'retrieval failed', code: 'rag_error' };
        })(),
      ),
    );
    renderPage();

    await user.type(screen.getByRole('textbox', { name: /ask a question/i }), 'Q');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn't answer/i);
    expect(alert).toHaveTextContent('retrieval failed');
    expect(screen.getByText('Partial grounded text')).toBeInTheDocument();
  });

  // --- retrieval scope (folder + content type) -------------------------

  it('omits the search scope by default (whole context)', async () => {
    const user = userEvent.setup();
    const ragInference = stubRag(() => Promise.resolve(ragStream()));
    renderPage();
    await user.type(screen.getByRole('textbox', { name: /ask a question/i }), 'Q');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(ragInference).toHaveBeenCalled());
    const req = ragInference.mock.calls[0]?.[0] as { search?: unknown };
    expect(req.search).toBeUndefined();
  });

  it('scopes RAG to the selected content type', async () => {
    const user = userEvent.setup();
    const ragInference = stubRag(() => Promise.resolve(ragStream()));
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Documents' }));
    await user.type(screen.getByRole('textbox', { name: /ask a question/i }), 'Q');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(ragInference).toHaveBeenCalled());
    const req = ragInference.mock.calls[0]?.[0] as {
      search?: { contentTypes?: string[]; folderId?: string };
    };
    expect(req.search).toEqual({ contentTypes: ['documents'] });
  });

  it('scopes RAG to the selected folder', async () => {
    const user = userEvent.setup();
    const ragInference = vi.fn((_req: unknown) => Promise.resolve(ragStream()));
    mockedClient.mockReturnValue({
      inference: { ragInference },
      folders: { listFolders: vi.fn().mockResolvedValue(pageOf([{ id: 'f1', name: 'Reports' }])) },
    } as never);
    renderPage();

    // The folder picker appears once folders load; pick Reports.
    await user.click(await screen.findByRole('combobox', { name: /folder/i }));
    await user.click(await screen.findByRole('option', { name: 'Reports' }));
    await user.type(screen.getByRole('textbox', { name: /ask a question/i }), 'Q');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(ragInference).toHaveBeenCalled());
    const req = ragInference.mock.calls[0]?.[0] as { search?: { folderId?: string } };
    expect(req.search?.folderId).toBe('f1');
  });

  it('pre-scopes from a ?folderId= deep-link', async () => {
    const user = userEvent.setup();
    const ragInference = vi.fn((_req: unknown) => Promise.resolve(ragStream()));
    mockedClient.mockReturnValue({
      inference: { ragInference },
      folders: { listFolders: vi.fn().mockResolvedValue(pageOf([{ id: 'f1', name: 'Reports' }])) },
    } as never);
    renderPage('/ai/ask?folderId=f1');

    // No folder interaction — the URL seeds the scope. Wait for folders to load.
    await screen.findByRole('combobox', { name: /folder/i });
    await user.type(screen.getByRole('textbox', { name: /ask a question/i }), 'Q');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(ragInference).toHaveBeenCalled());
    const req = ragInference.mock.calls[0]?.[0] as { search?: { folderId?: string } };
    expect(req.search?.folderId).toBe('f1');
  });

  it('clamps a stale/deleted deep-linked folderId back to whole-context', async () => {
    const user = userEvent.setup();
    const ragInference = vi.fn((_req: unknown) => Promise.resolve(ragStream()));
    // The deep-linked folder "ghost" is not among the loaded folders.
    mockedClient.mockReturnValue({
      inference: { ragInference },
      folders: { listFolders: vi.fn().mockResolvedValue(pageOf([{ id: 'f1', name: 'Reports' }])) },
    } as never);
    renderPage('/ai/ask?folderId=ghost');

    // Once folders load, the clamp effect resets the stale id to "all".
    await screen.findByRole('combobox', { name: /folder/i });
    await user.type(screen.getByRole('textbox', { name: /ask a question/i }), 'Q');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(ragInference).toHaveBeenCalled());
    const req = ragInference.mock.calls[0]?.[0] as { search?: unknown };
    expect(req.search).toBeUndefined(); // never scoped to the deleted folder
  });
});
