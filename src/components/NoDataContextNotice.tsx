// ---------------------------------------------------------------------------
// NoDataContextNotice — the empty-state shown when the signed-in user can reach
// no data context.
//
// This is a common first-run situation: a freshly provisioned account holds
// only the control-plane context (managed in the admin app), which the data
// plane deliberately hides — so the user lands here with nothing to explore and
// needs to know why + what to do next.
//
// The guidance is role-aware:
//   - OWNER:    can provision contexts themselves — point them at the admin app.
//   - SUB_USER: cannot self-provision — tell them to ask an administrator.
// (A null/loading role is treated as least-privilege, i.e. the sub-user copy.)
//
// Shared by the home landing notice and the data-route gate (RequireContext);
// the gate additionally offers a "back home" action.
// ---------------------------------------------------------------------------

import { Alert, AlertTitle, Button, Stack } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import { FormattedMessage } from 'react-intl';

import { useCurrentTenant } from '../auth';
import { BRAND } from '../brand';

interface NoDataContextNoticeProps {
  /** Also render a "back home" action — used by the data-route gate, not the home page itself. */
  readonly homeAction?: boolean;
}

export function NoDataContextNotice({ homeAction = false }: NoDataContextNoticeProps): React.JSX.Element {
  const { activeMembership } = useCurrentTenant();
  const isOwner = activeMembership?.role === 'OWNER';

  const actions = (
    <Stack direction="row" spacing={1}>
      {isOwner && (
        <Button
          component="a"
          href={BRAND.adminAppUrl}
          target="_blank"
          rel="noopener noreferrer"
          color="inherit"
          size="small"
        >
          <FormattedMessage id="context.openAdminApp" />
        </Button>
      )}
      {homeAction && (
        <Button component={RouterLink} to="/" color="inherit" size="small">
          <FormattedMessage id="context.gateHome" />
        </Button>
      )}
    </Stack>
  );

  const hasAction = isOwner || homeAction;

  return (
    <Alert severity="info" {...(hasAction ? { action: actions } : {})}>
      <AlertTitle>
        <FormattedMessage id="context.emptyTitle" />
      </AlertTitle>
      <FormattedMessage id={isOwner ? 'context.emptyOwnerBody' : 'context.emptySubUserBody'} />
    </Alert>
  );
}
