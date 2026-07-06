// ---------------------------------------------------------------------------
// Application entry point.
//
// Responsibilities (in order):
//   1. Validate runtime config (throws at module load if env is incomplete).
//   2. Configure Amplify against the Cognito User Pool.
//   3. Install global unhandled-rejection / error logging — these complement
//      the React ErrorBoundary (which catches render-phase errors) by
//      catching async/Promise errors that React does not see.
//   4. Set the document title from BRAND so re-skins don't require touching
//      index.html.
//   5. Wire the partner-API token minter to the auth adapter.
//   6. Mount the React tree under StrictMode + ErrorBoundary +
//      QueryClientProvider + IntlProvider + ThemeProvider + Router.
// ---------------------------------------------------------------------------

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Amplify } from 'aws-amplify';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { AuthProvider, CognitoAuthProvider, CurrentTenantProvider, ErrorBoundary } from '@vectros-ai/react';
import { setPartnerApiTokenMinter } from '@vectros-ai/react';

import App from './App';
import { CurrentContextProvider } from './auth/CurrentContextProvider';
import { COGNITO_CONFIG, API_CONFIG } from './config';
import { BRAND } from './brand';
import { theme } from './theme';
import { IntlProvider } from './i18n/IntlProvider';
import { createQueryClient } from './lib/queryClient';

// Module-level QueryClient singleton — one cache for the app lifetime.
// Tests instantiate fresh per-test clients (see src/test/*).
const queryClient = createQueryClient();

// 1. Config validated by importing it (requireEnv throws on missing values).

// 2. Configure Amplify. We pass only the Cognito identity-provider settings;
//    the app does not use Amplify Storage / API / DataStore. The AWS region is
//    encoded in the userPoolId (e.g. `us-east-1_ABC` → us-east-1) and Amplify
//    v6 derives it automatically — no separate region field.
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: COGNITO_CONFIG.userPoolId,
      userPoolClientId: COGNITO_CONFIG.userPoolClientId,
    },
  },
});

// 3. Global async error logging. Render-phase errors are caught by
//    ErrorBoundary; this covers everything else. No PII / query params logged.
window.addEventListener('unhandledrejection', (event) => {
  console.error('[app-vectros-ai] unhandled promise rejection', event.reason);
});
window.addEventListener('error', (event) => {
  console.error('[app-vectros-ai] uncaught error', event.error ?? event.message);
});

// 4. Brand-driven document title (re-skins via src/brand.ts only).
document.title = BRAND.productName;

// 5. Instantiate the auth-provider adapter. To swap providers in a fork,
//    change THIS line (and the matching import). Everything downstream depends
//    only on the AuthProviderAdapter interface in @vectros-ai/react.
const authProvider = new CognitoAuthProvider({
  developerApiBase: API_CONFIG.developerApiBase,
  productName: BRAND.productName,
});

// 5a. Wire the partner-API token cache's minter to the just-instantiated
//     adapter. The cache (consumed by the SDK's token supplier — non-React code
//     that can't read `useAuth()`) stays provider-agnostic: it knows nothing
//     about how a bearer is minted. CognitoAuthProvider.mintPartnerApiToken does
//     the Vectros-specific work (developer-API scoped-token). A fork swaps
//     the provider above + wires its own minter here.
//
//     Unlike admin-app (which is control-plane-locked and mints a CONSTANT
//     `vectros-admin` context), app.vectros.ai is the DATA plane and varies the
//     context per the context switcher. So this minter forwards BOTH arguments
//     verbatim — `tenantId` AND the optional `contextId` — letting the call site
//     (the SDK token supplier, which reads the active context) decide the target
//     context. The selected context flows through getVectrosApiToken(tenantId,
//     contextId) → here → mintPartnerApiToken(tenantId, contextId).
//
//     Backend dependency: per-context minting. Until per-context minting
//     deploys, the developer-API mint ignores `?context=` and returns the
//     caller's default context — so an OWNER can browse the `default` context
//     against staging today; non-default contexts activate when it ships.
setPartnerApiTokenMinter((tenantId, contextId) =>
  authProvider.mintPartnerApiToken(tenantId, contextId),
);

// 6. Mount.
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    {/*
      ErrorBoundary intentionally lives OUTSIDE IntlProvider so the boundary
      can still render if react-intl itself fails to mount (catalog import
      error, etc.). ErrorBoundary's copy is hardcoded English + BRAND
      interpolation — a safety net for the safety net.
    */}
    <ErrorBoundary supportEmail={BRAND.supportEmail}>
      {/*
        QueryClientProvider sits inside ErrorBoundary so render errors from
        Query-driven components are caught by the same safety net, but OUTSIDE
        IntlProvider/ThemeProvider/Router so the cache is available to every
        consumer regardless of theming/intl/route boundaries. ReactQueryDevtools
        mounts only in dev (Vite's import.meta.env.DEV is statically false in
        prod → dead-code-eliminated from the bundle).
      */}
      <QueryClientProvider client={queryClient}>
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
        <IntlProvider>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <BrowserRouter>
              <AuthProvider provider={authProvider}>
                {/*
                  CurrentTenantProvider resolves the active tenant (from the
                  `active_tenant` JWT claim + memberships) — the tenantId half of
                  the (tenant, context) mint. The context half (CurrentContext
                  Provider + ContextSwitcher) layers on top of this in a
                  follow-up commit.
                */}
                <CurrentTenantProvider>
                  {/*
                    CurrentContextProvider sits inside CurrentTenantProvider
                    because it enumerates contexts per the active tenant + role,
                    and inside QueryClientProvider because a context switch
                    refetches context-scoped data. It is the data-plane analogue
                    of CurrentTenantProvider.
                  */}
                  <CurrentContextProvider>
                    <App />
                  </CurrentContextProvider>
                </CurrentTenantProvider>
              </AuthProvider>
            </BrowserRouter>
          </ThemeProvider>
        </IntlProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
