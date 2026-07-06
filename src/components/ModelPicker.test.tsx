// ---------------------------------------------------------------------------
// ModelPicker tests — soft-annotated model list (tiers + credit rate) and the
// load-error fallback, with the registry hook mocked.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ModelPicker } from './ModelPicker';
import { TestProviders } from '../test/TestProviders';

vi.mock('../hooks/useInferenceModels', () => ({ useInferenceModels: vi.fn() }));
import { useInferenceModels } from '../hooks/useInferenceModels';

const mocked = vi.mocked(useInferenceModels);

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

describe('ModelPicker', () => {
  beforeEach(() => mocked.mockReset());

  it('shows the selected model name and annotates options with tiers + credit rate', async () => {
    mocked.mockReturnValue({ data: MODELS, isPending: false, isError: false } as never);
    const user = userEvent.setup();
    render(
      <TestProviders>
        <ModelPicker value="haiku" onChange={vi.fn()} />
      </TestProviders>,
    );

    // Closed control shows just the selected model's name (renderValue).
    expect(screen.getByRole('combobox', { name: /model/i })).toHaveTextContent('Claude Haiku');

    // Open the menu — options carry the tier + credit-rate annotation.
    await user.click(screen.getByRole('combobox', { name: /model/i }));
    const opus = await screen.findByRole('option', { name: /Claude Opus/ });
    expect(opus).toHaveTextContent('enterprise');
    expect(opus).toHaveTextContent('15/75 cr per 1k tokens');
  });

  it('reports a load error with a fallback note', () => {
    mocked.mockReturnValue({ data: undefined, isPending: false, isError: true } as never);
    render(
      <TestProviders>
        <ModelPicker value={undefined} onChange={vi.fn()} />
      </TestProviders>,
    );
    expect(screen.getByText(/couldn't load the model list/i)).toBeInTheDocument();
  });

  it('shows a loading hint while the registry loads', () => {
    mocked.mockReturnValue({ data: undefined, isPending: true, isError: false } as never);
    render(
      <TestProviders>
        <ModelPicker value="" onChange={vi.fn()} />
      </TestProviders>,
    );
    expect(screen.getByText(/loading models/i)).toBeInTheDocument();
  });

  it('shows a plain (non-alert) note when the registry returns no models', () => {
    mocked.mockReturnValue({
      data: { defaultModel: '', models: [] },
      isPending: false,
      isError: false,
    } as never);
    render(
      <TestProviders>
        <ModelPicker value="" onChange={vi.fn()} />
      </TestProviders>,
    );
    expect(screen.getByText(/no inference models are available/i)).toBeInTheDocument();
    // Crucially NOT an alert — an Alert's role="alert" would collide with the
    // AI surfaces' inference-error alert (the regression this guards against).
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
