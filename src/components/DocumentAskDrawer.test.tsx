// ---------------------------------------------------------------------------
// DocumentAskDrawer tests — streams a document-scoped answer (with the loaded-
// context note), SDK inference client + model registry mocked.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CurrentTenantProvider } from '@vectros-ai/react';
import type { TenantMembership } from '@vectros-ai/react';

import { DocumentAskDrawer } from './DocumentAskDrawer';
import { CurrentContextProvider } from '../auth/CurrentContextProvider';
import { TestProviders } from '../test/TestProviders';

vi.mock('../api/vectrosApi', () => ({ vectrosApiClient: vi.fn() }));
import { vectrosApiClient } from '../api/vectrosApi';

vi.mock('../hooks/useInferenceModels', () => ({ useInferenceModels: vi.fn() }));
import { useInferenceModels } from '../hooks/useInferenceModels';

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

async function* askStream(): AsyncGenerator<unknown> {
  yield {
    event: 'document_context',
    documentId: 'doc_7',
    title: 'Report',
    textBytes: 2048,
    model: 'haiku',
  };
  yield { event: 'content_delta', delta: 'The doc ' };
  yield { event: 'content_delta', delta: 'says X.' };
  yield {
    event: 'done',
    inputTokens: 1,
    outputTokens: 1,
    model: 'haiku',
    platformCreditsCharged: 0,
    inferenceBalanceCentsCharged: 0,
  };
}

function stubAsk(
  impl: (req: unknown) => Promise<AsyncIterable<unknown>>,
): ReturnType<typeof vi.fn> {
  const documentAsk = vi.fn(impl);
  mockedClient.mockReturnValue({ inference: { documentAsk } } as never);
  return documentAsk;
}

function renderDrawer(): void {
  render(
    <TestProviders>
      <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
        <CurrentContextProvider
          initialContexts={[{ contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' }]}
          initialContext="default"
        >
          <DocumentAskDrawer open documentId="doc_7" documentTitle="Report" onClose={vi.fn()} />
        </CurrentContextProvider>
      </CurrentTenantProvider>
    </TestProviders>,
  );
}

describe('DocumentAskDrawer', () => {
  beforeEach(() => {
    mockedClient.mockReset();
    mockedModels.mockReset();
    mockedModels.mockReturnValue({
      data: { defaultModel: 'haiku', models: [] },
      isPending: false,
      isError: false,
    } as never);
  });

  it('asks the document and streams a scoped answer', async () => {
    const user = userEvent.setup();
    const documentAsk = stubAsk(() => Promise.resolve(askStream()));
    renderDrawer();

    await user.type(
      screen.getByRole('textbox', { name: /ask a question about this document/i }),
      'What does it say?',
    );
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(screen.getByText('The doc says X.')).toBeInTheDocument());
    // The document_context note renders the loaded byte count.
    expect(screen.getByText(/2048 bytes/)).toBeInTheDocument();

    // The request pinned the document id + prompt.
    const req = documentAsk.mock.calls[0]?.[0] as { id: string; prompt: string };
    expect(req.id).toBe('doc_7');
    expect(req.prompt).toBe('What does it say?');
  });

  it('surfaces an error', async () => {
    const user = userEvent.setup();
    stubAsk(() =>
      Promise.resolve(
        (async function* () {
          yield { event: 'error', message: 'boom', code: 'doc_ask_error' };
        })(),
      ),
    );
    renderDrawer();

    await user.type(
      screen.getByRole('textbox', { name: /ask a question about this document/i }),
      'Q',
    );
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(screen.getByText(/couldn't answer/i)).toBeInTheDocument());
  });

  it('preserves the partial answer and surfaces the error detail on a mid-stream error', async () => {
    const user = userEvent.setup();
    stubAsk(() =>
      Promise.resolve(
        (async function* () {
          yield { event: 'content_delta', delta: 'Partial doc answer' };
          yield { event: 'error', message: 'context too large', code: 'doc_ask_error' };
        })(),
      ),
    );
    renderDrawer();

    await user.type(
      screen.getByRole('textbox', { name: /ask a question about this document/i }),
      'Q',
    );
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn't answer/i);
    expect(alert).toHaveTextContent('context too large');
    expect(screen.getByText('Partial doc answer')).toBeInTheDocument();
  });
});
