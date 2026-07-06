// ---------------------------------------------------------------------------
// ContextSwitcher — top-nav control for switching the active AppContext.
//
// The data-plane analogue of admin-app's TenantSwitcher, but at the CONTEXT
// grain — and it spans tenants: the same context name (e.g. `default`) exists in
// both the live and test tenant, so every option is labelled with its tenant
// kind (Live/Test) and the control identifies a `(tenant, context)` pair.
// Selecting one swaps the active selection (a token swap — see
// CurrentContextProvider).
//
// Visibility:
//   - loading / zero reachable contexts → render nothing.
//   - exactly one reachable context → a static label (nothing to switch).
//   - two or more → a dropdown; selecting one triggers the switch.
//
// The enumeration + switch live in useCurrentContext(); this component is pure
// presentation over that state.
// ---------------------------------------------------------------------------

import { FormControl, MenuItem, Select, Typography } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import { useIntl } from 'react-intl';
import type { IntlShape } from 'react-intl';

import { useCurrentContext } from '../auth';
import type { AppContextOption } from '../auth';

/** Stable unique key for a (tenant, context) option — contextId alone is not
 *  unique (the same context exists in more than one tenant). */
function slotKey(option: Pick<AppContextOption, 'tenantId' | 'contextId'>): string {
  return `${option.tenantId}|${option.contextId}`;
}

/** Human label for a tenant kind. */
function kindLabel(intl: IntlShape, kind: AppContextOption['tenantKind']): string {
  return intl.formatMessage({ id: kind === 'live' ? 'context.tenantLive' : 'context.tenantTest' });
}

/** Base switcher label for an option: "<name> · <Live|Test>". */
function baseLabel(intl: IntlShape, option: AppContextOption): string {
  return `${option.name} · ${kindLabel(intl, option.tenantKind)}`;
}

/**
 * Build a label resolver that appends the (unique) context id ONLY to options
 * whose "<name> · <kind>" label collides with another's — so distinct contexts
 * that happen to share a display name stay distinguishable, with no id bloat on
 * the common (unique) case.
 */
function makeLabeler(
  intl: IntlShape,
  contexts: ReadonlyArray<AppContextOption>,
): (option: AppContextOption) => string {
  const counts = new Map<string, number>();
  for (const c of contexts) {
    const base = baseLabel(intl, c);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return (option) => {
    const base = baseLabel(intl, option);
    return (counts.get(base) ?? 0) > 1 ? `${base} (${option.contextId})` : base;
  };
}

export function ContextSwitcher(): React.JSX.Element | null {
  const { context, activeTenantId, setContext, contexts, loading, switching } = useCurrentContext();
  const intl = useIntl();

  // Nothing to show until a context resolves; an empty/error state is surfaced
  // by the page content, not the AppBar control.
  if (loading || contexts.length === 0 || context === null || activeTenantId === null) return null;

  const label = intl.formatMessage({ id: 'layout.contextSwitcherLabel' });
  const active =
    contexts.find((c) => c.tenantId === activeTenantId && c.contextId === context) ?? null;
  const labelFor = makeLabeler(intl, contexts);

  // Single reachable context → a static label (collapses the switcher). Still
  // shows the tenant kind so the user knows which tenant they're in.
  if (contexts.length === 1) {
    const only = contexts[0];
    return (
      <Typography variant="body2" sx={{ color: 'inherit', fontWeight: 600 }} aria-label={label}>
        {only ? labelFor(only) : context}
      </Typography>
    );
  }

  const handleChange = (event: SelectChangeEvent): void => {
    const nextKey = event.target.value;
    const next = contexts.find((c) => slotKey(c) === nextKey);
    // Select fires onChange only on a real change, but guard anyway: re-selecting
    // the active option would needlessly drop the token cache + refetch.
    if (next && (next.tenantId !== activeTenantId || next.contextId !== context)) {
      void setContext(next);
    }
  };

  return (
    <FormControl size="small" variant="standard">
      <Select
        value={active ? slotKey(active) : ''}
        onChange={handleChange}
        variant="standard"
        // Disable while a switch is in flight (token re-mint + refetch) so a
        // user can't fire a second swap over the first.
        disabled={switching}
        // aria-label on the combobox so the control is reachable without a
        // visible <label> in the dense AppBar (WCAG 4.1.2).
        inputProps={{ 'aria-label': label }}
        sx={{
          color: 'inherit',
          fontWeight: 600,
          '& .MuiSelect-icon': { color: 'inherit' },
        }}
      >
        {contexts.map((c) => (
          <MenuItem key={slotKey(c)} value={slotKey(c)}>
            {labelFor(c)}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
