// ---------------------------------------------------------------------------
// HomePage — protected landing page (path: `/`).
//
// The data-plane entry point. It greets the signed-in user and surfaces their
// identity (enough to verify sign-in worked + to reference in support
// contacts); the active-context switcher lives in the top nav (AppLayout) and
// the records/documents surfaces have their own routes.
//
// The page is auth-provider-agnostic — it consumes useAuth().user, the
// normalized AuthUser. Swap providers without changing this file.
// ---------------------------------------------------------------------------

import { Alert, AlertTitle, Box, Card, CardContent, Stack, Typography } from '@mui/material';
import { FormattedMessage, useIntl } from 'react-intl';
import type { IntlShape } from 'react-intl';

import { useAuth, useCurrentContext } from '../../auth';
import { BRAND } from '../../brand';
import { NoDataContextNotice } from '../../components/NoDataContextNotice';

/**
 * Surfaces the context-enumeration outcome the ContextSwitcher can't show (it
 * hides itself when there's nothing to switch). Renders an error when
 * enumeration failed, or an empty state when the user can reach zero contexts —
 * so a user never sees a silently context-less app. Nothing while loading or
 * once at least one context is reachable.
 */
function ContextStateNotice(): React.JSX.Element | null {
  const { contexts, loading, error } = useCurrentContext();
  if (loading) return null;
  if (error) {
    return (
      <Alert severity="error">
        <AlertTitle>
          <FormattedMessage id="home.contextsErrorTitle" />
        </AlertTitle>
        <FormattedMessage id="home.contextsErrorBody" />
      </Alert>
    );
  }
  if (contexts.length === 0) {
    return <NoDataContextNotice />;
  }
  return null;
}

function formatFullName(
  intl: IntlShape,
  firstName: string | null,
  lastName: string | null,
): string {
  const parts: string[] = [];
  if (firstName) parts.push(firstName);
  if (lastName) parts.push(lastName);
  return parts.length > 0 ? parts.join(' ') : intl.formatMessage({ id: 'home.nameUnknown' });
}

interface InfoRowProps {
  readonly label: string;
  readonly value: string;
}

/**
 * Two-column "label : value" row used in the identity card. Stacks vertically
 * on small viewports, side-by-side on sm+.
 */
function InfoRow({ label, value }: InfoRowProps): React.JSX.Element {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        py: 1,
        borderBottom: 1,
        borderColor: 'divider',
        '&:last-child': { borderBottom: 0 },
      }}
    >
      <Typography
        component="dt"
        variant="caption"
        sx={{
          width: { xs: 'auto', sm: 120 },
          color: 'text.secondary',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 600,
          py: { xs: 0, sm: 0.5 },
        }}
      >
        {label}
      </Typography>
      <Typography component="dd" variant="body2" sx={{ flexGrow: 1, m: 0 }}>
        {value}
      </Typography>
    </Box>
  );
}

export function HomePage(): React.JSX.Element {
  const { user } = useAuth();
  const intl = useIntl();
  // Hide the "what's next" guidance when we KNOW there's no context to act on —
  // it would otherwise tell the user to "pick a context" the empty-state notice
  // just said they don't have. Shown while loading or once a context exists.
  const { contexts, loading: contextsLoading } = useCurrentContext();
  const hasNoContext = !contextsLoading && contexts.length === 0;

  // Defensive guard. RequireAuth ensures we only reach this component when a
  // user is loaded — but if a future refactor weakens that, fail soft (no
  // crash, just an empty placeholder) rather than throwing here.
  if (!user) {
    return <Typography>…</Typography>;
  }

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          {user.firstName ? (
            <FormattedMessage id="home.headingWithName" values={{ firstName: user.firstName }} />
          ) : (
            <FormattedMessage id="home.heading" />
          )}
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
          <FormattedMessage id="home.intro" values={{ productName: BRAND.productName }} />
        </Typography>
      </Box>

      <ContextStateNotice />

      <Card>
        <CardContent>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 2 }}>
            <FormattedMessage id="home.identityTitle" />
          </Typography>
          <Box component="dl" sx={{ m: 0 }}>
            <InfoRow
              label={intl.formatMessage({ id: 'home.nameLabel' })}
              value={formatFullName(intl, user.firstName, user.lastName)}
            />
            <InfoRow label={intl.formatMessage({ id: 'home.emailLabel' })} value={user.email} />
            <InfoRow label={intl.formatMessage({ id: 'home.userIdLabel' })} value={user.sub} />
          </Box>
        </CardContent>
      </Card>

      {!hasNoContext && (
        <Card>
          <CardContent>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
              <FormattedMessage id="home.nextStepsTitle" />
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <FormattedMessage id="home.nextStepsBody" />
            </Typography>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}
