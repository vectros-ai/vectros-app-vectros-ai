// ---------------------------------------------------------------------------
// Auth entry point for app.vectros.ai.
//
// The auth stack (provider-agnostic adapter, Cognito reference implementation,
// partner-API token cache keyed by (tenant, context), scope gating, tenant
// switching) lives in the shared @vectros-ai/react package so the reference
// apps share one implementation. This module re-exports it as the app's single
// auth import surface — call sites do `import { useAuth } from '../auth'`.
//
// The data-plane-specific CurrentContextProvider / useCurrentContext (the
// context switcher's state) will be added here alongside these re-exports.
//
// To swap auth providers in a fork: implement AuthProviderAdapter (see
// @vectros-ai/react) and construct it in main.tsx; nothing here changes.
// ---------------------------------------------------------------------------

export * from '@vectros-ai/react';

// Data-plane current-context state (app.vectros.ai-specific; layered on the
// shared auth stack). Re-exported here so call sites import the whole auth
// surface from one place, matching the @vectros-ai/react convention.
//
// NOTE: `useActiveTenantId` below intentionally **overrides** the same-named
// export from `@vectros-ai/react` (the global `active_tenant` hook) for app
// code — an explicit named re-export takes precedence over the `export *` above.
// In the data plane the tenant for a data call is the SELECTED context's tenant
// (contexts span the live + test tenants), so the data-plane hook resolves from
// the active context. Data pages call `useActiveTenantId()` unchanged.
export { CurrentContextProvider } from './CurrentContextProvider';
export type { CurrentContextProviderProps } from './CurrentContextProvider';
export { useCurrentContext, useActiveContextId, useActiveTenantId } from './useCurrentContext';
export type { AppContextOption, CurrentContextValue } from './useCurrentContext';
