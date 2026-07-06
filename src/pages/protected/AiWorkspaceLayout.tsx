// ---------------------------------------------------------------------------
// AiWorkspaceLayout — the `/ai` section shell (Option B). One "AI" nav entry → a
// section with sub-tabs, each laid out
// true to its API shape: Chat (multi-turn) and Ask-your-
// data (single-shot, grounded). Renders the sub-nav + the active sub-route via
// <Outlet />. Inside RequireContext, so the active context is resolved.
// ---------------------------------------------------------------------------

import { Box, Stack, Tab, Tabs, Typography } from '@mui/material';
import { Link as RouterLink, Outlet, useLocation } from 'react-router';
import { FormattedMessage } from 'react-intl';

import { useActiveContextId, useActiveTenantId } from '../../auth';

/** Sub-tabs of the AI workspace. */
const AI_TABS: ReadonlyArray<{ readonly to: string; readonly labelId: string }> = [
  { to: '/ai/chat', labelId: 'ai.tabChat' },
  { to: '/ai/ask', labelId: 'ai.tabAsk' },
];

export function AiWorkspaceLayout(): React.JSX.Element {
  const { pathname } = useLocation();
  const context = useActiveContextId();
  const tenant = useActiveTenantId();
  // Match the active tab by path prefix; fall back to the first tab.
  const active = AI_TABS.find((t) => pathname.startsWith(t.to))?.to ?? AI_TABS[0]?.to ?? false;

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          <FormattedMessage id="ai.title" />
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
          <FormattedMessage id="ai.subtitle" />
        </Typography>
      </Box>

      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={active}>
          {AI_TABS.map((t) => (
            <Tab
              key={t.to}
              value={t.to}
              component={RouterLink}
              to={t.to}
              label={<FormattedMessage id={t.labelId} />}
            />
          ))}
        </Tabs>
      </Box>

      {/* Key the active AI page by the (tenant, context) pair so a context switch
          fully remounts it, clearing chat threads / grounded answers from the
          prior context (they can't carry over — the data they reference is
          context-scoped). The tenant is part of the key because the data plane
          spans a user's live + test tenants, which can hold same-named contexts
          (both a `default`): keying on the contextId alone would yield the same
          key across a live↔test switch and skip the remount. */}
      <Box key={`${tenant}:${context}`}>
        <Outlet />
      </Box>
    </Stack>
  );
}
