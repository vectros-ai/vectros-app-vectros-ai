// ---------------------------------------------------------------------------
// MarkdownView tests — rendering AND the safety posture. Document text is
// untrusted customer content; these tests pin the properties the component's
// header comment promises (no raw-HTML execution, sanitized URL schemes,
// external-safe links). If one of these fails after a dependency bump, treat
// it as a security regression, not a styling nit.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';

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

// ---------------------------------------------------------------------------
// Hostile destinations. The oracle is the browser's own URL parser, applied to
// every href and src the rendered tree would hand a browser: an attribute is unsafe
// unless it resolves to one of the schemes react-markdown allows. The expectation
// never applies the transformation under test (no scheme regex of our own), so it
// cannot agree with a bug by construction.
// ---------------------------------------------------------------------------

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'irc:', 'ircs:', 'xmpp:']);
const BASE = 'https://app.example/';

function urlAttributes(container: HTMLElement): string[] {
  const urls: string[] = [];
  container.querySelectorAll('[href], [src]').forEach((element) => {
    for (const name of ['href', 'src']) {
      const value = element.getAttribute(name);
      if (value !== null) urls.push(value);
    }
  });
  return urls;
}

function unsafeUrls(container: HTMLElement): string[] {
  return urlAttributes(container).filter((url) => {
    try {
      return !SAFE_PROTOCOLS.has(new URL(url, BASE).protocol);
    } catch {
      return true;
    }
  });
}

const NBSP = String.fromCharCode(0xa0);
const SOH = String.fromCharCode(1);
const B64_SCRIPT = 'PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==';

const HOSTILE: ReadonlyArray<readonly [string, string]> = [
  ['a plain javascript: link', '[x](javascript:alert(1))'],
  ['a mixed-case scheme', '[x](JaVaScRiPt:alert(1))'],
  ['an entity-encoded first letter', '[x](&#106;avascript:alert(1))'],
  ['a hex-entity-encoded first letter', '[x](&#x6A;avascript:alert(1))'],
  ['a whitespace-led destination (space entity)', '[x](&#32;javascript:alert(1))'],
  ['a tab-led destination', '[x](&#9;javascript:alert(1))'],
  ['a newline-led destination', '[x](&#10;javascript:alert(1))'],
  ['a carriage-return-led destination', '[x](&#13;javascript:alert(1))'],
  ['a form-feed-led destination', '[x](&#12;javascript:alert(1))'],
  ['an NBSP-led destination (numeric entity)', '[x](&#160;javascript:alert(1))'],
  ['an NBSP-led destination (named entity)', '[x](&nbsp;javascript:alert(1))'],
  ['an NBSP-led destination (literal character)', `[x](${NBSP}javascript:alert(1))`],
  ['a C0-control-led destination', `[x](${SOH}javascript:alert(1))`],
  ['a tab inside the scheme', '[x](java&#9;script:alert(1))'],
  ['a newline inside the scheme', '[x](java&#10;script:alert(1))'],
  ['a carriage return inside the scheme', '[x](java&#13;script:alert(1))'],
  ['a reference-style link', '[x][r]\n\n[r]: javascript:alert(1)'],
  ['a reference-style link with a title', '[x][r]\n\n[r]: javascript:alert(1) "title"'],
  ['a reference-style link, mixed-case label and scheme', '[x][R]\n\n[r]: JAVASCRIPT:alert(1)'],
  ['a collapsed reference link', '[x][]\n\n[x]: javascript:alert(1)'],
  ['a shortcut reference link', '[x]\n\n[x]: javascript:alert(1)'],
  ['an angle-bracket destination', '[x](<javascript:alert(1)>)'],
  ['an angle-bracket destination with spaces', '[x](<javascript:alert(1) foo>)'],
  ['an angle-bracket data: destination', `[x](<data:text/html;base64,${B64_SCRIPT}>)`],
  ['an angle-bracket reference definition', '[x][r]\n\n[r]: <javascript:alert(1)>'],
  ['an autolink', '<javascript:alert(1)>'],
  ['a mixed-case autolink', '<JAVASCRIPT:alert(1)>'],
  ['a data: link', `[x](data:text/html;base64,${B64_SCRIPT})`],
  ['a vbscript: link', '[x](vbscript:msgbox(1))'],
  ['a file: link', '[x](file:///etc/passwd)'],
  ['a blob: link', '[x](blob:https://example.com/00000000-0000-0000-0000-000000000000)'],
  ['a javascript: image src', '![x](javascript:alert(1))'],
  ['a mixed-case image src', '![x](JaVaScRiPt:alert(1))'],
  ['an entity-encoded image src', '![x](&#106;avascript:alert(1))'],
  ['an NBSP-led image src', '![x](&#160;javascript:alert(1))'],
  ['a tab-led image src', '![x](&#9;javascript:alert(1))'],
  ['a data: SVG image src', '![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)'],
  ['a vbscript: image src', '![x](vbscript:msgbox(1))'],
  ['an angle-bracket image src', '![x](<javascript:alert(1)>)'],
  ['a reference-style image', '![x][r]\n\n[r]: javascript:alert(1)'],
  ['an image inside a link, both hostile', '[![x](javascript:alert(1))](javascript:alert(2))'],
  ['a hostile link inside a table cell', '| a |\n|---|\n| [x](javascript:alert(1)) |'],
  ['a hostile link inside emphasis and a list', '- *[x](javascript:alert(1))*'],
];

// Cases that are knowingly NOT parsed as a link or image at all, so there is no URL to
// inspect (the markdown parser leaves them as text). Everything else must produce an
// anchor or an image, so a parser change cannot quietly turn a case into a vacuous pass.
const PARSED_AS_TEXT = new Set<string>(['a C0-control-led destination']);

describe('MarkdownView hostile destinations', () => {
  it.each(HOSTILE)('%s never reaches the DOM as an unsafe URL', (name, source) => {
    const { container } = render(<MarkdownView>{source}</MarkdownView>);
    if (!PARSED_AS_TEXT.has(name)) {
      expect(container.querySelectorAll('a, img').length).toBeGreaterThan(0);
    }
    expect(unsafeUrls(container)).toEqual([]);
    // Nothing executable came through the source either.
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toMatch(/\son\w+=/i);
  });

  it('keeps the safe links and images that sit beside a hostile one', () => {
    const { container } = render(
      <MarkdownView>
        {[
          '[bad](javascript:alert(1))',
          '[web](https://example.com/docs)',
          '[mail](mailto:someone@example.com)',
          '[rooted](/docs/page)',
          '![pic](https://example.com/pic.png)',
        ].join('\n\n')}
      </MarkdownView>,
    );

    expect(unsafeUrls(container)).toEqual([]);
    expect(screen.getByRole('link', { name: 'web' })).toHaveAttribute('href', 'https://example.com/docs');
    expect(screen.getByRole('link', { name: 'mail' })).toHaveAttribute('href', 'mailto:someone@example.com');
    expect(screen.getByRole('link', { name: 'rooted' })).toHaveAttribute('href', '/docs/page');
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/pic.png');
  });

  // Positive control: the oracle above must be able to see the bug. A renderer that
  // leaves URLs untransformed (exactly what this component must never do) is flagged
  // on the same kinds of input, so an empty result above means something.
  it.each([
    ['a plain link', '[x](javascript:alert(1))'],
    ['a reference-style link', '[x][r]\n\n[r]: javascript:alert(1)'],
    ['an image src', '![x](javascript:alert(1))'],
  ])('positive control: the oracle flags an untransformed renderer on %s', (_name, source) => {
    const { container } = render(
      <ReactMarkdown urlTransform={(url) => url}>{source}</ReactMarkdown>,
    );
    expect(unsafeUrls(container)).not.toEqual([]);
  });
});
