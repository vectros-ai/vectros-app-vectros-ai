// ---------------------------------------------------------------------------
// PageHeader tests — the shared top-of-page header.
//
// Covers: the title renders as the page's <h1>; the subtitle is optional; and
// the actions slot renders alongside the title when provided.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders the title as the page <h1>', () => {
    render(<PageHeader title="Records" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Records' })).toBeInTheDocument();
  });

  it('renders the subtitle when provided', () => {
    render(<PageHeader title="Records" subtitle="Browse and edit your records." />);
    expect(screen.getByText('Browse and edit your records.')).toBeInTheDocument();
  });

  it('omits the subtitle line when none is given', () => {
    const { container } = render(<PageHeader title="Account" />);
    // Only the <h1> — no secondary paragraph.
    expect(container.querySelectorAll('p')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Account' })).toBeInTheDocument();
  });

  it('renders the actions slot alongside the title', () => {
    render(
      <PageHeader
        title="Documents"
        subtitle="Your files."
        actions={<button type="button">Add document</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Documents' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add document' })).toBeInTheDocument();
  });
});
