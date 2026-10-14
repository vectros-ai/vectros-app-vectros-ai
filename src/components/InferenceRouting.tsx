// ---------------------------------------------------------------------------
// InferenceRouting — the model controls shared by the AI workspace surfaces.
//
// Default: the platform model picker. Typing a provider alias switches the call
// to the model provider your account owner configured: the registry picker (and
// its per-1k credit annotations, which describe platform billing) is replaced
// by an optional provider-model field, and a notice says plainly that the call
// is served by that provider and leaves the Vectros perimeter. This is the one
// place that notice lives, so every screen says the same thing. The app only
// ever handles the alias string; the provider's endpoint and key are managed by
// the account owner elsewhere and are never shown here.
// ---------------------------------------------------------------------------

import { useId } from 'react';
import { Alert, Box, Stack, TextField } from '@mui/material';
import { useIntl } from 'react-intl';

import type { InferenceRouting as InferenceRoutingState } from '../hooks/useInferenceRouting';
import { ModelPicker } from './ModelPicker';

interface InferenceRoutingProps {
  readonly routing: InferenceRoutingState;
  readonly disabled?: boolean;
}

/**
 * The alias is matched exactly and is lowercase, and a model id is just as
 * literal: keep phone keyboards from capitalising or "correcting" either.
 */
const INPUT_ATTRIBUTES = {
  autoComplete: 'off',
  autoCapitalize: 'off',
  autoCorrect: 'off',
  spellCheck: false,
} as const;

export function InferenceRouting({ routing, disabled }: InferenceRoutingProps): React.JSX.Element {
  const intl = useIntl();
  const off = disabled === true;
  const base = useId();
  const aliasId = `${base}-alias`;
  const noticeId = `${base}-notice`;
  return (
    <Stack sx={{ alignItems: 'flex-start' }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start' }}>
        <TextField
          size="small"
          sx={{ minWidth: 260 }}
          id={aliasId}
          label={intl.formatMessage({ id: 'ai.route.aliasLabel' })}
          helperText={intl.formatMessage({ id: 'ai.route.aliasHelp' })}
          value={routing.alias}
          onChange={(e) => routing.setAlias(e.target.value)}
          disabled={off}
          slotProps={{
            htmlInput: {
              ...INPUT_ATTRIBUTES,
              // While the notice is showing it describes this field too.
              ...(routing.routed
                ? { 'aria-describedby': `${aliasId}-helper-text ${noticeId}` }
                : {}),
            },
          }}
        />
        {routing.routed ? (
          <TextField
            size="small"
            sx={{ minWidth: 260 }}
            label={intl.formatMessage({ id: 'ai.route.modelLabel' })}
            helperText={intl.formatMessage({ id: 'ai.route.modelHelp' })}
            value={routing.providerModel}
            onChange={(e) => routing.setProviderModel(e.target.value)}
            disabled={off}
            slotProps={{ htmlInput: INPUT_ATTRIBUTES }}
          />
        ) : (
          <ModelPicker
            value={routing.registryModel}
            onChange={routing.setRegistryModel}
            disabled={off}
          />
        )}
      </Box>
      {/* The status region stays mounted (empty) so the notice is announced when
          its text is swapped in; a node inserted already holding its text is
          often not. A polite `status` keeps it out of the assertive `alert`
          role that the screens' error banner relies on. */}
      <Box id={noticeId} role="status" sx={{ alignSelf: 'stretch' }}>
        {routing.routed && (
          <Alert severity="warning" role="note" sx={{ mt: 1.5 }}>
            {intl.formatMessage({ id: 'ai.route.disclosure' })}
          </Alert>
        )}
      </Box>
    </Stack>
  );
}
