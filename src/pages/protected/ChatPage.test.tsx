// ---------------------------------------------------------------------------
// ChatPage tests — streams a mocked chat reply through the thread, with the SDK
// inference client + model registry mocked.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CurrentTenantProvider } from '@vectros-ai/react';
import type { TenantMembership } from '@vectros-ai/react';

import { ChatPage } from './ChatPage';
import { CurrentContextProvider } from '../../auth/CurrentContextProvider';
import { TestProviders } from '../../test/TestProviders';
import { statusError } from '../../test/statusError';

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

async function* streamOf(deltas: string[]): AsyncGenerator<unknown> {
  for (const delta of deltas) yield { event: 'content_delta', delta };
  yield {
    event: 'done',
    inputTokens: 1,
    outputTokens: 1,
    model: 'haiku',
    platformCreditsCharged: 0,
    inferenceBalanceCentsCharged: 0,
  };
}

function stubChat(
  impl: (req: unknown) => Promise<AsyncIterable<unknown>>,
): ReturnType<typeof vi.fn> {
  const chatInference = vi.fn(impl);
  mockedClient.mockReturnValue({ inference: { chatInference } } as never);
  return chatInference;
}

function renderPage(): void {
  render(
    <TestProviders>
      <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
        <CurrentContextProvider
          initialContexts={[{ contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' }]}
          initialContext="default"
        >
          <ChatPage />
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

describe('ChatPage', () => {
  beforeEach(() => {
    mockedClient.mockReset();
    mockedModels.mockReset();
    mockedModels.mockReturnValue({
      data: { defaultModel: 'haiku', models: [] },
      isPending: false,
      isError: false,
    } as never);
  });

  it('shows the empty state before any message', () => {
    stubChat(() => Promise.resolve(streamOf([])));
    renderPage();
    expect(screen.getByText(/start a conversation/i)).toBeInTheDocument();
  });

  it('sends a message and streams the reply into the thread', async () => {
    const user = userEvent.setup();
    const chatInference = stubChat(() => Promise.resolve(streamOf(['Hi ', 'there'])));
    renderPage();

    await user.type(screen.getByRole('textbox', { name: /send a message/i }), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    // The user's turn shows immediately; the assistant reply commits after 'done'.
    expect(screen.getByText('Hello')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Hi there')).toBeInTheDocument());

    // The whole thread (the user turn) was forwarded as the request.
    expect(chatInference).toHaveBeenCalledTimes(1);
    const req = chatInference.mock.calls[0]?.[0] as {
      messages: { role: string; content: string }[];
    };
    expect(req.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('carries prior turns on a follow-up send (multi-turn thread)', async () => {
    const user = userEvent.setup();
    const chatInference = stubChat(() => Promise.resolve(streamOf(['Hi there'])));
    renderPage();
    const box = screen.getByRole('textbox', { name: /send a message/i });

    await user.type(box, 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('Hi there')).toBeInTheDocument());

    await user.type(box, 'Follow-up');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(chatInference).toHaveBeenCalledTimes(2));

    // The second request carries the full prior thread (user + assistant + new user).
    const req2 = chatInference.mock.calls[1]?.[0] as {
      messages: { role: string; content: string }[];
    };
    expect(req2.messages).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'Follow-up' },
    ]);
  });

  it('sends on Enter', async () => {
    const user = userEvent.setup();
    const chatInference = stubChat(() => Promise.resolve(streamOf(['ok'])));
    renderPage();
    await user.type(screen.getByRole('textbox', { name: /send a message/i }), 'Hi{Enter}');
    await waitFor(() => expect(chatInference).toHaveBeenCalledTimes(1));
  });

  it('does not commit an empty assistant turn on a content-less reply', async () => {
    const user = userEvent.setup();
    stubChat(() => Promise.resolve(streamOf([]))); // straight to done, no deltas
    renderPage();
    await user.type(screen.getByRole('textbox', { name: /send a message/i }), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    // The run completes (composer re-enabled) but no assistant bubble is committed.
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /send a message/i })).toBeEnabled(),
    );
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.queryByText(/^Assistant$/)).not.toBeInTheDocument();
  });

  it('surfaces a stream error without committing an assistant turn', async () => {
    const user = userEvent.setup();
    stubChat(() =>
      Promise.resolve(
        (async function* () {
          yield { event: 'error', message: 'boom', code: 'inference_error' };
        })(),
      ),
    );
    renderPage();

    await user.type(screen.getByRole('textbox', { name: /send a message/i }), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText(/couldn't respond/i)).toBeInTheDocument());
    // The user turn stays; no assistant bubble was committed.
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getAllByText(/^You$/i)).toHaveLength(1);
  });

  it('preserves already-streamed text and surfaces the error detail on a mid-stream error', async () => {
    const user = userEvent.setup();
    stubChat(() =>
      Promise.resolve(
        (async function* () {
          yield { event: 'content_delta', delta: 'Partial answer' };
          yield { event: 'error', message: 'model timed out', code: 'timeout' };
        })(),
      ),
    );
    renderPage();

    await user.type(screen.getByRole('textbox', { name: /send a message/i }), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    // The friendly title announces (role=alert) AND the backend detail shows…
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn't respond/i);
    expect(alert).toHaveTextContent('model timed out');
    // …and the partial answer the user already saw is NOT discarded.
    expect(screen.getByText('Partial answer')).toBeInTheDocument();
  });

  describe('provider alias', () => {
    async function send(user: ReturnType<typeof userEvent.setup>): Promise<void> {
      await user.type(screen.getByRole('textbox', { name: /send a message/i }), 'Hello');
      await user.click(screen.getByRole('button', { name: 'Send' }));
    }

    it('sends no providerAlias, and the registry model, when no alias is typed', async () => {
      const user = userEvent.setup();
      const chatInference = stubChat(() => Promise.resolve(streamOf(['Hi'])));
      renderPage();
      await send(user);

      await waitFor(() => expect(chatInference).toHaveBeenCalled());
      const req = chatInference.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(req).not.toHaveProperty('providerAlias');
      expect(req.model).toBe('haiku');
    });

    it('sends the alias and the typed provider model, not the registry model', async () => {
      const user = userEvent.setup();
      const chatInference = stubChat(() => Promise.resolve(streamOf(['Hi'])));
      renderPage();
      await user.type(screen.getByRole('textbox', { name: /provider alias/i }), 'my-provider');
      await user.type(screen.getByRole('textbox', { name: /provider model/i }), 'provider-model-1');
      await send(user);

      await waitFor(() => expect(chatInference).toHaveBeenCalled());
      const req = chatInference.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(req.providerAlias).toBe('my-provider');
      expect(req.model).toBe('provider-model-1');
      expect(req.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    });

    it('omits model, so the provider default applies, when only an alias is typed', async () => {
      const user = userEvent.setup();
      const chatInference = stubChat(() => Promise.resolve(streamOf(['Hi'])));
      renderPage();
      await user.type(screen.getByRole('textbox', { name: /provider alias/i }), 'my-provider');
      await send(user);

      await waitFor(() => expect(chatInference).toHaveBeenCalled());
      const req = chatInference.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(req.providerAlias).toBe('my-provider');
      expect(req).not.toHaveProperty('model');
    });

    it('shows the disclosure while an alias is set and streams the reply', async () => {
      const user = userEvent.setup();
      stubChat(() => Promise.resolve(streamOf(['Hi ', 'there'])));
      renderPage();
      await user.type(screen.getByRole('textbox', { name: /provider alias/i }), 'my-provider');
      expect(screen.getByText(/leaves the Vectros perimeter/i)).toBeInTheDocument();
      await send(user);

      await waitFor(() => expect(screen.getByText('Hi there')).toBeInTheDocument());
    });

    it('explains a 403 (unknown or inactive alias, missing waiver) instead of the raw error', async () => {
      const user = userEvent.setup();
      stubChat(() =>
        Promise.reject(statusError(403, { message: 'Unknown or inactive provider alias: nope' })),
      );
      renderPage();
      await user.type(screen.getByRole('textbox', { name: /provider alias/i }), 'nope');
      await send(user);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/this call was refused/i);
      expect(alert.textContent).not.toMatch(/Status code|Body:/);
    });

    it('uses the current alias on each send (changing it between turns changes the request)', async () => {
      const user = userEvent.setup();
      const chatInference = stubChat(() => Promise.resolve(streamOf(['Hi'])));
      renderPage();
      const alias = screen.getByRole('textbox', { name: /provider alias/i });
      await user.type(alias, 'provider-a');
      await send(user);
      await waitFor(() => expect(chatInference).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByText('Hi')).toBeInTheDocument());

      await user.clear(alias);
      await user.type(alias, 'provider-b');
      await user.type(screen.getByRole('textbox', { name: /send a message/i }), 'Again');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(chatInference).toHaveBeenCalledTimes(2));

      const first = chatInference.mock.calls[0]?.[0] as Record<string, unknown>;
      const second = chatInference.mock.calls[1]?.[0] as Record<string, unknown>;
      expect(first.providerAlias).toBe('provider-a');
      expect(second.providerAlias).toBe('provider-b');
    });

    it('does not blame a missing model for a 400 once a provider model was typed', async () => {
      const user = userEvent.setup();
      stubChat(() =>
        Promise.reject(statusError(400, { message: 'messages must contain a user message.' })),
      );
      renderPage();
      await user.type(screen.getByRole('textbox', { name: /provider alias/i }), 'my-provider');
      await user.type(screen.getByRole('textbox', { name: /provider model/i }), 'provider-model-1');
      await send(user);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('messages must contain a user message.');
      expect(alert).not.toHaveTextContent(/no model was named/i);
    });

    it('trims the alias and the provider model before sending', async () => {
      const user = userEvent.setup();
      const chatInference = stubChat(() => Promise.resolve(streamOf(['Hi'])));
      renderPage();
      await user.type(screen.getByRole('textbox', { name: /provider alias/i }), '  my-provider ');
      await user.type(
        screen.getByRole('textbox', { name: /provider model/i }),
        ' provider-model-1  ',
      );
      await send(user);

      await waitFor(() => expect(chatInference).toHaveBeenCalled());
      const req = chatInference.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(req.providerAlias).toBe('my-provider');
      expect(req.model).toBe('provider-model-1');
    });

    it('keeps the notice on screen while the call is still streaming', async () => {
      const user = userEvent.setup();
      stubChat(() => Promise.resolve(NEVER_ENDING_STREAM()));
      renderPage();
      await user.type(screen.getByRole('textbox', { name: /provider alias/i }), 'my-provider');
      await send(user);

      expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument();
      expect(screen.getByText(/leaves the Vectros perimeter/i)).toBeInTheDocument();
    });

    it('keeps the notice on screen after a refused call, next to the error', async () => {
      const user = userEvent.setup();
      stubChat(() => Promise.reject(statusError(403, { message: 'x' })));
      renderPage();
      await user.type(screen.getByRole('textbox', { name: /provider alias/i }), 'my-provider');
      await send(user);

      expect(await screen.findByRole('alert')).toHaveTextContent(/this call was refused/i);
      expect(screen.getByText(/leaves the Vectros perimeter/i)).toBeInTheDocument();
    });

    it('writes nothing to local or session storage', async () => {
      const user = userEvent.setup();
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      stubChat(() => Promise.resolve(streamOf(['Hi'])));
      renderPage();
      await user.type(screen.getByRole('textbox', { name: /provider alias/i }), 'my-provider');
      await send(user);
      await waitFor(() => expect(screen.getByText('Hi')).toBeInTheDocument());
      // Neither storage (local or session) was written with the alias.
      expect(JSON.stringify(setItem.mock.calls)).not.toMatch(/my-provider/);
      setItem.mockRestore();
    });

    it.each([402, 500])(
      'shows the platform message for a platform-model %i, not the SDK error text (no alias set)',
      async (status) => {
        const user = userEvent.setup();
        stubChat(() => Promise.reject(statusError(status, { message: 'Platform said no.' })));
        renderPage();
        await send(user);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Platform said no.');
        expect(alert).not.toHaveTextContent(/Status code|Body:|Error/);
      },
    );

    it.each([
      [429, 'BALANCE_BUSY', 'Your pre-paid inference balance is busy. This is not a shortage: retry in a moment.'],
      [503, 'BALANCE_UNAVAILABLE', 'A temporary fault interrupted the balance step. This is not a shortage: retry in a moment.'],
    ])('shows the platform message for a %i %s refusal on the platform path, never the SDK text', async (status, errorCode, message) => {
      const user = userEvent.setup();
      stubChat(() => Promise.reject(statusError(status, { message, errorCode })));
      renderPage();
      await send(user);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(message);
      expect(alert).not.toHaveTextContent(/Status code|Body:|BALANCE_/);
    });

    it('a platform-path refusal that carries no message shows a neutral line with the status', async () => {
      const user = userEvent.setup();
      stubChat(() => Promise.reject(statusError(503, undefined)));
      renderPage();
      await send(user);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('The request failed (status 503). Please try again.');
      expect(alert).not.toHaveTextContent(/Status code|Body:/);
    });

    it('shows the platform message for a platform-model 403, not the provider-routed 403 text (no alias set)', async () => {
      const user = userEvent.setup();
      stubChat(() => Promise.reject(statusError(403, { message: 'whatever' })));
      renderPage();
      await send(user);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('whatever');
      expect(alert).not.toHaveTextContent(/this call was refused/i);
      expect(alert).not.toHaveTextContent(/Status code|Body:/);
    });

    it('explains a 400 (no model, no provider default) instead of the raw error', async () => {
      const user = userEvent.setup();
      stubChat(() => Promise.reject(statusError(400, { message: 'No model was named.' })));
      renderPage();
      await user.type(screen.getByRole('textbox', { name: /provider alias/i }), 'my-provider');
      await send(user);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/enter one above/i);
      expect(alert.textContent).not.toMatch(/Status code|Body:/);
    });
  });
});
