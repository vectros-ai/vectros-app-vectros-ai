// ---------------------------------------------------------------------------
// NotFoundPage — dedicated 404 for unknown routes (path: `*`).
//
// Rendered OUTSIDE AppLayout (no app chrome) because an unknown URL may be hit
// by an unauthenticated visitor too. The "back to home" link points at `/`,
// which funnels through RequireAuth — an unauth user lands on /login from
// there, an authed user lands on the home page.
// ---------------------------------------------------------------------------

import { Box, Button, Container, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import { FormattedMessage } from 'react-intl';

import { BRAND } from '../../brand';

export function NotFoundPage(): React.JSX.Element {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'background.default',
      }}
    >
      <Container
        component="main"
        maxWidth="sm"
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          textAlign: 'center',
          py: { xs: 4, sm: 6 },
        }}
      >
        <Stack spacing={3} alignItems="center">
          <Typography
            variant="h5"
            component="span"
            sx={{ fontWeight: 700, display: 'block' }}
          >
            {BRAND.productName}
          </Typography>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
            <FormattedMessage id="notFound.title" />
          </Typography>
          <Typography variant="body1" color="text.secondary">
            <FormattedMessage id="notFound.body" />
          </Typography>
          <Button component={RouterLink} to="/" variant="contained">
            <FormattedMessage id="notFound.backHome" />
          </Button>
        </Stack>
      </Container>
    </Box>
  );
}
