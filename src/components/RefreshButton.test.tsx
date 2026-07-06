// ---------------------------------------------------------------------------
// RefreshButton tests — click invokes onClick; the loading state disables the
// button and shows a spinner.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RefreshButton } from './RefreshButton';

describe('RefreshButton', () => {
  it('invokes onClick and is labelled for assistive tech', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} loading={false} label="Refresh records" />);

    await user.click(screen.getByRole('button', { name: 'Refresh records' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disables and shows a spinner while loading', () => {
    render(<RefreshButton onClick={vi.fn()} loading label="Refresh records" />);

    expect(screen.getByRole('button', { name: 'Refresh records' })).toBeDisabled();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});
