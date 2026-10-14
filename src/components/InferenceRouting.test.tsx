// ---------------------------------------------------------------------------
// InferenceRouting tests — the platform picker by default; a typed provider
// alias swaps it for the provider-model field, drops the platform credit
// annotation, and shows the disclosure.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { InferenceRouting } from './InferenceRouting';
import { useInferenceRouting } from '../hooks/useInferenceRouting';
import { TestProviders } from '../test/TestProviders';

vi.mock('../hooks/useInferenceModels', () => ({ useInferenceModels: vi.fn() }));
import { useInferenceModels } from '../hooks/useInferenceModels';

const mockedModels = vi.mocked(useInferenceModels);

const MODELS = {
  defaultModel: 'haiku',
  models: [
    {
      id: 'haiku',
      name: 'Claude Haiku',
      provider: 'Anthropic',
      contextWindow: 200000,
      availableOn: ['free', 'pro'],
      inputCreditsPer1kTokens: 1,
      outputCreditsPer1kTokens: 3,
    },
    {
      id: 'opus',
      name: 'Claude Opus',
      provider: 'Anthropic',
      contextWindow: 200000,
      availableOn: ['enterprise'],
      inputCreditsPer1kTokens: 15,
      outputCreditsPer1kTokens: 75,
    },
  ],
};

function Harness(): React.JSX.Element {
  const routing = useInferenceRouting();
  return (
    <>
      <InferenceRouting routing={routing} />
      <output data-testid="fields">{JSON.stringify(routing.requestFields())}</output>
    </>
  );
}

function renderHarness(): void {
  render(
    <TestProviders>
      <Harness />
    </TestProviders>,
  );
}

const fields = (): unknown => JSON.parse(screen.getByTestId('fields').textContent ?? '');
const aliasBox = (): HTMLElement => screen.getByRole('textbox', { name: /provider alias/i });
const modelBox = (): HTMLElement => screen.getByRole('textbox', { name: /provider model/i });

/** The always-mounted status region the notice is written into. */
function statusRegion(): HTMLElement {
  const regions = document.querySelectorAll<HTMLElement>('[role="status"]');
  if (regions.length !== 1 || regions[0] === undefined) {
    throw new Error(`expected exactly one status region, found ${regions.length}`);
  }
  return regions[0];
}

describe('InferenceRouting', () => {
  beforeEach(() => {
    mockedModels.mockReset();
    mockedModels.mockReturnValue({ data: MODELS, isPending: false, isError: false } as never);
  });

  it('shows the platform model picker, and no provider controls or disclosure, with no alias', () => {
    renderHarness();
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('Claude Haiku');
    expect(screen.queryByRole('textbox', { name: /provider model/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/leaves the Vectros perimeter/i)).not.toBeInTheDocument();
    expect(fields()).toEqual({ model: 'haiku' });
  });

  it('swaps the picker for a provider-model field and shows the disclosure once an alias is typed', async () => {
    const user = userEvent.setup();
    renderHarness();
    // Control: with no alias the open picker DOES carry the platform credit rates.
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    expect((await screen.findAllByText(/cr per 1k/i)).length).toBeGreaterThan(0);
    await user.keyboard('{Escape}');

    await user.type(aliasBox(), 'my-provider');

    // No registry ids and no platform credit annotation on the provider path.
    expect(screen.queryByRole('combobox', { name: 'Model' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.queryByText(/cr per 1k/i)).not.toBeInTheDocument();
    expect(modelBox()).toBeInTheDocument();

    expect(
      screen.getByText(/served by your account owner's own model provider/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/leaves the Vectros perimeter/i)).toBeInTheDocument();
    expect(fields()).toEqual({ providerAlias: 'my-provider' });
  });

  it('sends the typed provider model, not the registry model', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.type(aliasBox(), 'my-provider');
    await user.type(modelBox(), 'provider-model-1');
    expect(fields()).toEqual({ providerAlias: 'my-provider', model: 'provider-model-1' });
  });

  it('sends the alias and model trimmed', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.type(aliasBox(), '  my-provider  ');
    await user.type(modelBox(), '  provider-model-1 ');
    expect(fields()).toEqual({ providerAlias: 'my-provider', model: 'provider-model-1' });
  });

  describe('the provider model belongs to one alias', () => {
    it('is dropped when the alias is cleared, so it is not sent to the next alias', async () => {
      const user = userEvent.setup();
      renderHarness();
      await user.type(aliasBox(), 'provider-a');
      await user.type(modelBox(), 'model-for-a');
      await user.clear(aliasBox());
      await user.type(aliasBox(), 'provider-b');

      expect(modelBox()).toHaveValue('');
      expect(fields()).toEqual({ providerAlias: 'provider-b' });
    });

    it('is dropped when the alias changes to a different one', async () => {
      const user = userEvent.setup();
      renderHarness();
      await user.type(aliasBox(), 'provider-a');
      await user.type(modelBox(), 'model-for-a');
      await user.type(aliasBox(), 'x');

      expect(modelBox()).toHaveValue('');
      expect(fields()).toEqual({ providerAlias: 'provider-ax' });
    });

    it('is kept when only stray whitespace around the alias changes', async () => {
      const user = userEvent.setup();
      renderHarness();
      await user.type(aliasBox(), 'provider-a');
      await user.type(modelBox(), 'model-for-a');
      await user.type(aliasBox(), '  ');

      expect(modelBox()).toHaveValue('model-for-a');
      expect(fields()).toEqual({ providerAlias: 'provider-a', model: 'model-for-a' });
    });
  });

  it('keeps the alias and model inputs literal: no capitalising, correcting or autofill', async () => {
    const user = userEvent.setup();
    renderHarness();
    for (const box of [aliasBox()]) {
      expect(box).toHaveAttribute('autocapitalize', 'off');
      expect(box).toHaveAttribute('autocorrect', 'off');
      expect(box).toHaveAttribute('autocomplete', 'off');
      expect(box).toHaveAttribute('spellcheck', 'false');
    }
    await user.type(aliasBox(), 'my-provider');
    expect(modelBox()).toHaveAttribute('autocapitalize', 'off');
    expect(modelBox()).toHaveAttribute('autocorrect', 'off');
    expect(modelBox()).toHaveAttribute('autocomplete', 'off');
    expect(modelBox()).toHaveAttribute('spellcheck', 'false');
  });

  it('tells people to type the alias exactly as written, in lowercase', () => {
    renderHarness();
    expect(
      screen.getByText(/lowercase letters, digits, hyphens and underscores/i),
    ).toBeInTheDocument();
  });

  describe('the notice', () => {
    it('lives in a status region that is mounted before any alias is typed, and empty', () => {
      renderHarness();
      const region = statusRegion();
      expect(region).toBeEmptyDOMElement();
      expect(aliasBox().getAttribute('aria-describedby') ?? '').not.toContain(region.id);
    });

    it('is written into that same region (not a new node), politely, and tied to the alias field', async () => {
      const user = userEvent.setup();
      renderHarness();
      const region = statusRegion();
      await user.type(aliasBox(), 'my-provider');

      expect(statusRegion()).toBe(region);
      expect(region).toHaveTextContent(/leaves the Vectros perimeter/i);
      // It must not take the `alert` role the screens' error banner relies on.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(aliasBox().getAttribute('aria-describedby')).toContain(region.id);
    });

    it('is emptied again when the alias is cleared', async () => {
      const user = userEvent.setup();
      renderHarness();
      await user.type(aliasBox(), 'my-provider');
      await user.clear(aliasBox());
      expect(statusRegion()).toBeEmptyDOMElement();
    });

    it('never claims the call stays inside the platform', async () => {
      const user = userEvent.setup();
      renderHarness();
      await user.type(aliasBox(), 'my-provider');
      expect(statusRegion().textContent).not.toMatch(
        /in-perimeter|no[- ]egress|stays? (inside|within)|never leaves|does not leave|US[- ]region|US only/i,
      );
    });
  });

  it('returns to the platform picker, with the earlier selection, when the alias is cleared', async () => {
    const user = userEvent.setup();
    renderHarness();
    // Pick a NON-default model first, so a reset to the default would be visible.
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.click(await screen.findByRole('option', { name: /Claude Opus/ }));
    expect(fields()).toEqual({ model: 'opus' });

    await user.type(aliasBox(), 'my-provider');
    await user.clear(aliasBox());
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('Claude Opus');
    expect(screen.queryByText(/leaves the Vectros perimeter/i)).not.toBeInTheDocument();
    expect(fields()).toEqual({ model: 'opus' });
  });

  it('treats a whitespace-only alias as no alias', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.type(aliasBox(), '   ');
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeInTheDocument();
    expect(fields()).toEqual({ model: 'haiku' });
  });

  it('writes nothing to local or session storage', async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderHarness();
    await user.type(aliasBox(), 'my-provider');
    await user.type(modelBox(), 'provider-model-1');
    // Neither storage (local or session) was written with the alias or the model.
    expect(JSON.stringify(setItem.mock.calls)).not.toMatch(/my-provider|provider-model-1/);
    setItem.mockRestore();
  });
});
