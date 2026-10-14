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
import { statusError } from '../test/statusError';

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

/** A stream that yields one delta and then never ends (the call is still running). */
async function* NEVER_ENDING_STREAM(): AsyncGenerator<unknown> {
  yield { event: 'content_delta', delta: 'Partial' };
  await new Promise<never>(() => undefined);
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

  describe('provider alias', () => {
    async function ask(user: ReturnType<typeof userEvent.setup>): Promise<void> {
      await user.type(
        screen.getByRole('textbox', { name: /ask a question about this document/i }),
        'Q',
      );
      await user.click(screen.getByRole('button', { name: 'Ask' }));
    }

    it('sends no providerAlias, and the registry model, when no alias is typed', async () => {
      const user = userEvent.setup();
      const documentAsk = stubAsk(() => Promise.resolve(askStream()));
      renderDrawer();
      await ask(user);

      await waitFor(() => expect(documentAsk).toHaveBeenCalled());
      const req = documentAsk.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(req).not.toHaveProperty('providerAlias');
      expect(req.model).toBe('haiku');
    });

    it('sends the alias and the typed provider model, with the document id pinned', async () => {
      const user = userEvent.setup();
      const documentAsk = stubAsk(() => Promise.resolve(askStream()));
      renderDrawer();
      await user.type(screen.getByRole('textbox', { name: /provider alias/i }), 'my-provider');
      await user.type(screen.getByRole('textbox', { name: /provider model/i }), 'provider-model-1');
      await ask(user);

      await waitFor(() => expect(documentAsk).toHaveBeenCalled());
      const req = documentAsk.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(req.providerAlias).toBe('my-provider');
      expect(req.model).toBe('provider-model-1');
      expect(req.id).toBe('doc_7');
    });

    it('clears the alias when the drawer is reopened, so it does not carry to another document', async () => {
      const user = userEvent.setup();
      const documentAsk = stubAsk(() => Promise.resolve(askStream()));
      const tree = (open: boolean, documentId: string): React.JSX.Element => (
        <TestProviders>
          <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
            <CurrentContextProvider
              initialContexts={[
                { contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' },
              ]}
              initialContext="default"
            >
              <DocumentAskDrawer
                open={open}
                documentId={documentId}
                documentTitle="Report"
                onClose={vi.fn()}
              />
            </CurrentContextProvider>
          </CurrentTenantProvider>
        </TestProviders>
      );
      const { rerender } = render(tree(true, 'doc_7'));
      await user.type(screen.getByRole('textbox', { name: /provider alias/i }), 'my-provider');
      await user.type(screen.getByRole('textbox', { name: /provider model/i }), 'provider-model-1');
      expect(screen.getByText(/leaves the Vectros perimeter/i)).toBeInTheDocument();

      rerender(tree(false, 'doc_7'));
      rerender(tree(true, 'doc_8'));

      expect(screen.getByRole('textbox', { name: /provider alias/i })).toHaveValue('');
      expect(screen.queryByText(/leaves the Vectros perimeter/i)).not.toBeInTheDocument();
      // The model typed for the old alias is gone too: it must not reappear for a new one.
      await user.type(screen.getByRole('textbox', { name: /provider alias/i }), 'other');
      expect(screen.getByRole('textbox', { name: /provider model/i })).toHaveValue('');
      await user.clear(screen.getByRole('textbox', { name: /provider alias/i }));
      await ask(user);
      await waitFor(() => expect(documentAsk).toHaveBeenCalled());
      const req = documentAsk.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(req.id).toBe('doc_8');
      expect(req).not.toHaveProperty('providerAlias');
    });

    it('clears the alias and the provider model when reopened for the SAME document', async () => {
      const user = userEvent.setup();
      const tree = (open: boolean): React.JSX.Element => (
        <TestProviders>
          <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
            <CurrentContextProvider
              initialContexts={[
                { contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' },
              ]}
              initialContext="default"
            >
              <DocumentAskDrawer
                open={open}
                documentId="doc_7"
                documentTitle="Report"
                onClose={vi.fn()}
              />
            </CurrentContextProvider>
          </CurrentTenantProvider>
        </TestProviders>
      );
      stubAsk(() => Promise.resolve(askStream()));
      const { rerender } = render(tree(true));
      await user.type(screen.getByRole('textbox', { name: /provider alias/i }), 'my-provider');
      await user.type(screen.getByRole('textbox', { name: /provider model/i }), 'provider-model-1');

      rerender(tree(false));
      rerender(tree(true));

      expect(screen.getByRole('textbox', { name: /provider alias/i })).toHaveValue('');
      expect(screen.queryByRole('textbox', { name: /provider model/i })).not.toBeInTheDocument();
    });

    it('keeps the notice on screen while the call is still streaming', async () => {
      const user = userEvent.setup();
      stubAsk(() => Promise.resolve(NEVER_ENDING_STREAM()));
      renderDrawer();
      await user.type(screen.getByRole('textbox', { name: /provider alias/i }), 'my-provider');
      await ask(user);

      expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument();
      expect(screen.getByText(/leaves the Vectros perimeter/i)).toBeInTheDocument();
    });

    it('keeps the notice on screen after a refused call, next to the error', async () => {
      const user = userEvent.setup();
      stubAsk(() => Promise.reject(statusError(403, { message: 'x' })));
      renderDrawer();
      await user.type(screen.getByRole('textbox', { name: /provider alias/i }), 'my-provider');
      await ask(user);

      expect(await screen.findByRole('alert')).toHaveTextContent(/this call was refused/i);
      expect(screen.getByText(/leaves the Vectros perimeter/i)).toBeInTheDocument();
    });

    it.each([402, 500])(
      'leaves a platform-model %i exactly as before: the raw SDK text is still shown (no alias set)',
      async (status) => {
        const user = userEvent.setup();
        stubAsk(() => Promise.reject(statusError(status, { message: 'Platform said no.' })));
        renderDrawer();
        await ask(user);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(`Status code: ${status}`);
        expect(alert).not.toHaveTextContent(/The request failed/);
      },
    );

    it('does not rewrite a platform-model failure (no alias set)', async () => {
      const user = userEvent.setup();
      stubAsk(() => Promise.reject(statusError(403, { message: 'whatever' })));
      renderDrawer();
      await ask(user);

      const alert = await screen.findByRole('alert');
      expect(alert).not.toHaveTextContent(/this call was refused/i);
    });

    it('explains a 403 instead of the raw error', async () => {
      const user = userEvent.setup();
      stubAsk(() =>
        Promise.reject(statusError(403, { message: 'Unknown or inactive provider alias: x' })),
      );
      renderDrawer();
      await user.type(screen.getByRole('textbox', { name: /provider alias/i }), 'x');
      await ask(user);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/this call was refused/i);
      expect(alert.textContent).not.toMatch(/Status code|Body:/);
    });
  });
});
