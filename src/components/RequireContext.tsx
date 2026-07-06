// ---------------------------------------------------------------------------
// RequireContext — gate for context-scoped data routes.
//
// Data pages call useActiveContextId(), which throws if no context is active.
// This layout route ensures they only mount once a context is resolved:
//   - while contexts enumerate → a spinner;
//   - if enumeration FAILED → an error notice with retry guidance (distinct
//     from the empty state — a deep-link to /records during an outage must not
//     read as "you have no contexts");
//   - if none is reachable → an empty-state notice pointing the user home;
//   - otherwise → the matched data route (<Outlet/>), safely inside the gate.
// ---------------------------------------------------------------------------

import { Alert, AlertTitle } from '@mui/material';
import { Outlet } from 'react-router';
import { FormattedMessage, useIntl } from 'react-intl';
import { LoadingBlock } from '@vectros-ai/react';

import { useCurrentContext } from '../auth';
import { NoDataContextNotice } from './NoDataContextNotice';

export function RequireContext(): React.JSX.Element {
  const { context, loading, error } = useCurrentContext();
  const intl = useIntl();

  if (loading) {
    return (
      <LoadingBlock label={intl.formatMessage({ id: 'context.loading' })} py={8} />
    );
  }

  if (error) {
    return (
      <Alert severity="error">
        <AlertTitle>
          <FormattedMessage id="context.errorTitle" />
        </AlertTitle>
        <FormattedMessage id="context.errorBody" />
      </Alert>
    );
  }

  if (context === null) {
    return <NoDataContextNotice homeAction />;
  }

  return <Outlet />;
}
