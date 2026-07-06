// ---------------------------------------------------------------------------
// AccountPage — account & security hand-off (path: `/account`).
//
// app.vectros.ai is the DATA plane and does NOT own identity, profile, password,
// or MFA management — those are control-plane concerns owned by the admin app
// The shared AppLayout's user menu links here (it's a Vectros
// convention every reference app wires a `/account` route), so rather than a
// dead link we render a clear hand-off to the admin app where those settings
// actually live.
// ---------------------------------------------------------------------------

import { Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { FormattedMessage } from 'react-intl';

import { BRAND } from '../../brand';
import { PageHeader } from '../../components/PageHeader';

export function AccountPage(): React.JSX.Element {
  return (
    <Stack spacing={4}>
      <PageHeader title={<FormattedMessage id="account.title" />} />
      <Card>
        <CardContent>
          <Stack spacing={2} alignItems="flex-start">
            <Typography variant="body1" color="text.secondary">
              <FormattedMessage id="account.body" />
            </Typography>
            <Button
              variant="contained"
              href={BRAND.adminAppUrl}
              // The admin app is a separate origin; open in a new tab so the
              // user doesn't lose their data-plane session/context here.
              target="_blank"
              rel="noopener noreferrer"
            >
              <FormattedMessage id="account.openAdminCta" />
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
