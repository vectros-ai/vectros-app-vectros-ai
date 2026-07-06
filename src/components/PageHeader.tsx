// ---------------------------------------------------------------------------
// PageHeader — the standard top-of-page header for the data-plane screens.
//
// Every top-level page opens with the same shape: an h4 page title (the route's
// single <h1>), an optional secondary subtitle line, and optional right-aligned
// primary action(s). Consolidating it here keeps the title/subtitle typography,
// spacing, and the responsive action layout identical instead of each page
// re-deriving the same Box/Typography stack.
//
// Adopted so far by Account + Schemas; the remaining top-level pages (Home,
// Records, Documents, Search, the AI workspace) still hand-roll the same block
// and are migrated to this primitive as a follow-up.
//
// Detail pages (record / document / schema detail) lead with a back-link rather
// than a page title — that's a separate layout concern, not this component.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

interface PageHeaderProps {
  /** The page title — rendered as the route's single <h1>. */
  readonly title: ReactNode;
  /** Optional secondary line under the title. */
  readonly subtitle?: ReactNode;
  /**
   * Optional primary action(s) (e.g. a "New record" button or a small cluster
   * of buttons). Right-aligned beside the title on wide viewports; stacked
   * under it on narrow ones. Pass a single element or a Stack/Box of several.
   */
  readonly actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps): React.JSX.Element {
  const heading = (
    <Box>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      {subtitle != null && (
        <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
          {subtitle}
        </Typography>
      )}
    </Box>
  );

  // No actions → just the title block (no flex wrapper needed).
  if (actions == null) return heading;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { sm: 'flex-start' },
        justifyContent: 'space-between',
        gap: 2,
      }}
    >
      {heading}
      <Box sx={{ flexShrink: 0 }}>{actions}</Box>
    </Box>
  );
}
