// ---------------------------------------------------------------------------
// NotFoundPage tests — the 404 renders a heading and a "back home" link.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { NotFoundPage } from './NotFoundPage';
import { TestProviders } from '../../test/TestProviders';

describe('NotFoundPage', () => {
  it('renders the 404 heading and a link back to home', () => {
    render(
      <TestProviders>
        <NotFoundPage />
      </TestProviders>,
    );

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
  });
});
