// ---------------------------------------------------------------------------
// IndexStatusChip tests — the chip renders its label; a failure message is
// exposed as a hover tooltip.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { IndexStatusChip } from './IndexStatusChip';
import { TestProviders } from '../test/TestProviders';

describe('IndexStatusChip', () => {
  it('renders the status label', () => {
    render(
      <TestProviders>
        <IndexStatusChip label="Failed" color="error" failureMessage={undefined} />
      </TestProviders>,
    );
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('surfaces the failure message as a tooltip on hover', async () => {
    const user = userEvent.setup();
    render(
      <TestProviders>
        <IndexStatusChip label="Failed" color="error" failureMessage="Embedding failed." />
      </TestProviders>,
    );
    await user.hover(screen.getByText('Failed'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Embedding failed.');
  });

  it('renders no tooltip when there is no failure message', async () => {
    const user = userEvent.setup();
    render(
      <TestProviders>
        <IndexStatusChip label="Indexed" color="success" failureMessage={undefined} />
      </TestProviders>,
    );
    await user.hover(screen.getByText('Indexed'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('renders no tooltip for a whitespace-only message', async () => {
    const user = userEvent.setup();
    render(
      <TestProviders>
        <IndexStatusChip label="Failed" color="error" failureMessage="   " />
      </TestProviders>,
    );
    await user.hover(screen.getByText('Failed'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
