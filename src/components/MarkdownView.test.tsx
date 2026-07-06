// ---------------------------------------------------------------------------
// MarkdownView tests — rendering AND the safety posture. Document text is
// untrusted customer content; these tests pin the properties the component's
// header comment promises (no raw-HTML execution, sanitized URL schemes,
// external-safe links). If one of these fails after a dependency bump, treat
// it as a security regression, not a styling nit.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { MarkdownView } from './MarkdownView';

describe('MarkdownView', () => {
  it('renders headings, emphasis, and GFM tables', () => {
    const { container } = render(
      <MarkdownView>{'# Title\n\nSome **bold** text.\n\n| a | b |\n|---|---|\n| 1 | 2 |'}</MarkdownView>,
    );

    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(container.querySelector('strong')).toHaveTextContent('bold');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '1' })).toBeInTheDocument();
  });

  it('does NOT execute or render raw HTML from the source', () => {
    const { container } = render(
      <MarkdownView>{'before\n\n<script>window.__pwned = true;</script>\n\n<img src=x onerror="window.__pwned = true">\n\nafter'}</MarkdownView>,
    );

    // No script/img element may materialize from source HTML.
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it('strips javascript: and data: URLs from links', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>']) {
      const { container, unmount } = render(<MarkdownView>{`[click me](${bad})`}</MarkdownView>);
      const link = container.querySelector('a');
      expect(link).not.toBeNull();
      const href = link?.getAttribute('href') ?? '';
      expect(href).not.toContain('javascript:');
      expect(href).not.toContain('data:');
      unmount();
    }
  });

  it('renders links with external-safe attributes and no leaked node prop', () => {
    render(<MarkdownView>{'[docs](https://example.com/docs)'}</MarkdownView>);

    const link = screen.getByRole('link', { name: 'docs' });
    expect(link).toHaveAttribute('href', 'https://example.com/docs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // The hast `node` react-markdown hands to custom components must never
    // spread onto the DOM element.
    expect(link).not.toHaveAttribute('node');
  });

  it('renders Markdown images without a referrer leak', () => {
    const { container } = render(
      <MarkdownView>{'![diagram](https://example.com/diagram.png)'}</MarkdownView>,
    );

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'https://example.com/diagram.png');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(img).not.toHaveAttribute('node');
  });
});
