// ---------------------------------------------------------------------------
// LoginPage — sign in with email + password, with MFA challenge support.
//
// State machine:
//
//   credentials  ──signIn()→ COMPLETE        ──→ navigate(from || '/')
//                ─signIn()→ MFA_REQUIRED      ──→ mfa stage
//                ─signIn()→ (other results)   ──→ "finish setup in admin" error
//                ─signIn()→ AuthError         ──→ inline error
//
//   mfa          ──confirmSignIn()→ COMPLETE  ──→ navigate(from || '/')
//                ─confirmSignIn()→ AuthError   ──→ inline error
//                ─"back to sign in"            ──→ credentials stage
//
// app.vectros.ai is the DATA plane and does NOT own identity flows. The
// SignInResult union still carries account-setup outcomes (unconfirmed signup,
// forced TOTP enrollment, forced password reset) — those are handled here by
// directing the user to the admin app to finish account setup, rather than
// re-implementing enrollment/confirmation surfaces that belong in the control
// plane. Under the current OPTIONAL-MFA pool config a fully
// provisioned user only ever hits COMPLETE or MFA_REQUIRED.
//
// The page is auth-provider-agnostic — it consumes only useAuth() + the
// normalized SignInResult union + the AuthError vocabulary. Swap providers
// without touching this file.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { Alert, Box, Button, CircularProgress, Link, Stack, TextField } from '@mui/material';
import { FormattedMessage, useIntl } from 'react-intl';
import type { IntlShape } from 'react-intl';

import { useAuth, authErrorToMessage } from '../../auth';
import type { MfaMethod, SignInResult } from '../../auth';
import { AuthCard, PasswordField } from '@vectros-ai/react';
import { BRAND } from '../../brand';
import type { LocationFromState } from '../../lib/routerTypes';

type Stage =
  | { readonly kind: 'credentials' }
  | { readonly kind: 'mfa'; readonly methods: ReadonlyArray<MfaMethod> };

function mfaSubtitle(intl: IntlShape, methods: ReadonlyArray<MfaMethod>): string {
  if (methods.includes('TOTP')) return intl.formatMessage({ id: 'login.mfaSubtitleTotp' });
  if (methods.includes('SMS')) return intl.formatMessage({ id: 'login.mfaSubtitleSms' });
  if (methods.includes('EMAIL')) return intl.formatMessage({ id: 'login.mfaSubtitleEmail' });
  return intl.formatMessage({ id: 'login.mfaSubtitleGeneric' });
}

export function LoginPage(): React.JSX.Element {
  const { signIn, confirmSignIn, isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const intl = useIntl();

  const fromState = location.state as LocationFromState | null;
  const fromPath = fromState?.from?.pathname ?? '/';

  const [stage, setStage] = useState<Stage>({ kind: 'credentials' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const dispatchResult = (result: SignInResult): void => {
    switch (result.kind) {
      case 'COMPLETE':
        navigate(fromPath, { replace: true });
        return;
      case 'MFA_REQUIRED':
        setStage({ kind: 'mfa', methods: result.methods });
        setMfaCode('');
        setError(null);
        return;
      // Account-setup outcomes belong to the control plane. Rather than
      // re-implement confirmation / TOTP-enrollment / new-password surfaces,
      // direct the user to the admin app to finish setup.
      case 'CONFIRMATION_REQUIRED':
      case 'TOTP_SETUP_REQUIRED':
      case 'NEW_PASSWORD_REQUIRED':
        setError(intl.formatMessage({ id: 'login.accountSetupRequired' }));
        return;
    }
  };

  const handleCredentialsSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await signIn({ email: email.trim(), password });
      dispatchResult(result);
    } catch (err) {
      setError(authErrorToMessage(intl, err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleMfaSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await confirmSignIn({ challengeResponse: mfaCode.trim() });
      dispatchResult(result);
    } catch (err) {
      setError(authErrorToMessage(intl, err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackToSignIn = (): void => {
    setStage({ kind: 'credentials' });
    setMfaCode('');
    setError(null);
  };

  // If a valid session already exists, don't show the sign-in form — send the
  // user where they were headed (default home). Submitting credentials while
  // already signed in is rejected by the auth provider, so we redirect first.
  // The spinner while the session probe is in flight mirrors RequireAuth and
  // avoids flashing the form before the redirect resolves.
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress aria-label={intl.formatMessage({ id: 'layout.loadingSession' })} />
      </Box>
    );
  }
  if (isAuthenticated) {
    return <Navigate to={fromPath} replace />;
  }

  if (stage.kind === 'credentials') {
    return (
      <AuthCard
        brandName={BRAND.productName}
        title={intl.formatMessage({ id: 'login.title' })}
        subtitle={intl.formatMessage({ id: 'login.subtitle' }, { productName: BRAND.productName })}
      >
        <form onSubmit={handleCredentialsSubmit} noValidate>
          <Stack spacing={2}>
            {error && (
              <Alert severity="error" role="alert">
                {error}
              </Alert>
            )}
            <TextField
              label={intl.formatMessage({ id: 'login.emailLabel' })}
              type="email"
              autoComplete="email"
              // Auto-focus is the established UX expectation for sign-in forms
              // (every major identity provider does this). The a11y trade-off is
              // well-understood and accepted for this surface.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              required
              fullWidth
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
            <PasswordField
              label={intl.formatMessage({ id: 'login.passwordLabel' })}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              fullWidth
              disabled={submitting || !email.trim() || !password}
              startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              <FormattedMessage id={submitting ? 'login.submitting' : 'login.submit'} />
            </Button>
          </Stack>
        </form>
      </AuthCard>
    );
  }

  // MFA stage
  const mfaCodeLabel = intl.formatMessage({ id: 'login.mfaCodeLabel' });
  return (
    <AuthCard
      brandName={BRAND.productName}
      title={intl.formatMessage({ id: 'login.mfaTitle' })}
      subtitle={mfaSubtitle(intl, stage.methods)}
      footer={
        <Link component="button" type="button" variant="body2" onClick={handleBackToSignIn}>
          <FormattedMessage id="login.backToSignIn" />
        </Link>
      }
    >
      <form onSubmit={handleMfaSubmit} noValidate>
        <Stack spacing={2}>
          {error && (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          )}
          <TextField
            label={mfaCodeLabel}
            // MUI v7 — pass native-input HTML attributes through the
            // `slotProps.htmlInput` slot (v7-idiomatic; replaces v5 inputProps).
            slotProps={{
              htmlInput: {
                inputMode: 'numeric',
                pattern: '[0-9]*',
                autoComplete: 'one-time-code',
                'aria-label': mfaCodeLabel,
              },
            }}
            // The user just submitted credentials and is expecting to type a
            // code immediately — focusing the code field is the right UX.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            required
            fullWidth
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            disabled={submitting}
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={submitting || !mfaCode.trim()}
            startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            <FormattedMessage id={submitting ? 'login.mfaSubmitting' : 'login.mfaSubmit'} />
          </Button>
        </Stack>
      </form>
    </AuthCard>
  );
}
