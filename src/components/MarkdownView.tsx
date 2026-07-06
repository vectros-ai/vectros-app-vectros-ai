// ---------------------------------------------------------------------------
// MarkdownView — the in-app rendered view of a document's text body.
//
// Document text is customer-ingested content the platform stores verbatim and
// returns as JSON — rendering it is exactly the stored-XSS surface the API
// contract leaves to the consuming app, so safety is the design center here:
//   - react-markdown renders to React elements (no innerHTML anywhere);
//   - raw HTML in the source is NOT parsed or executed (no rehype-raw — HTML
//     tags come through as inert text);
//   - URLs pass react-markdown's default transform, whose scheme allowlist is
//     exactly http/https/irc/ircs/mailto/xmpp (javascript:, data:, vbscript:
//     etc. are emptied);
//   - links open in a new tab with rel="noopener noreferrer" (applied AFTER
//     the prop spread, so source content can't override them) so a linked page
//     can't reach back into this window;
//   - images DO load from their (scheme-allowlisted) remote URLs — an accepted
//     tradeoff: viewing a doc with an image reveals the viewer's IP to that
//     host, mitigated with referrerPolicy="no-referrer" + lazy loading.
// Keep those properties when touching this component — in particular, never
// add rehype-raw or a custom urlTransform that widens the scheme set.
//
// GFM (tables, task lists, strikethrough, autolinks) is enabled: typical
// knowledge-base Markdown leans on tables heavily.
// ---------------------------------------------------------------------------

import { Box } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownViewProps {
  /** The Markdown source to render (treated as untrusted). */
  readonly children: string;
}

/**
 * react-markdown passes the hast `node` to custom components — strip it so it
 * never spreads onto the DOM element as an attribute.
 */
type ElementProps<T> = T & { node?: unknown };

/** Anchor renderer: external-safe link attributes on every link. */
function SafeLink(
  props: ElementProps<React.AnchorHTMLAttributes<HTMLAnchorElement>>,
): React.JSX.Element {
  const { node: _node, children, ...rest } = props;
  return (
    <a {...rest} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** Image renderer: no referrer leak to the (untrusted) image host, lazy load. */
function SafeImage(props: ElementProps<React.ImgHTMLAttributes<HTMLImageElement>>): React.JSX.Element {
  // alt defaults to '' (decorative) when the Markdown omits it — ![](url).
  const { node: _node, alt = '', ...rest } = props;
  return <img {...rest} alt={alt} referrerPolicy="no-referrer" loading="lazy" />;
}

export function MarkdownView({ children }: MarkdownViewProps): React.JSX.Element {
  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 1,
        backgroundColor: 'action.hover',
        maxHeight: 480,
        overflowY: 'auto',
        overflowX: 'auto',
        // Typography for the rendered tree — scoped element styles rather than
        // per-node components, so the markdown renderer stays configuration-free.
        fontSize: '0.875rem',
        lineHeight: 1.6,
        wordBreak: 'break-word',
        '& > :first-of-type': { mt: 0 },
        '& > :last-child': { mb: 0 },
        '& h1, & h2, & h3, & h4, & h5, & h6': { lineHeight: 1.3, mt: 2.5, mb: 1 },
        '& h1': { fontSize: '1.4rem' },
        '& h2': { fontSize: '1.2rem' },
        '& h3': { fontSize: '1.05rem' },
        '& p': { my: 1 },
        '& pre': {
          p: 1.5,
          borderRadius: 1,
          backgroundColor: 'background.default',
          overflowX: 'auto',
          fontSize: '0.8125rem',
        },
        '& code': { fontFamily: 'monospace', fontSize: '0.8125rem' },
        '& blockquote': {
          borderLeft: 3,
          borderColor: 'divider',
          color: 'text.secondary',
          pl: 1.5,
          mx: 0,
        },
        '& table': { borderCollapse: 'collapse', display: 'block', overflowX: 'auto' },
        '& th, & td': { border: 1, borderColor: 'divider', px: 1, py: 0.5, textAlign: 'left' },
        '& img': { maxWidth: '100%' },
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: SafeLink, img: SafeImage }}>
        {children}
      </ReactMarkdown>
    </Box>
  );
}
