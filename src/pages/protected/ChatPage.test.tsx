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
});
