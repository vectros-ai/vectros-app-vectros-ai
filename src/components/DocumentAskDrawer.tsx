// ---------------------------------------------------------------------------
// DocumentAskDrawer — "Ask this document". A right-anchored drawer launched
// from a document's detail view: a prompt
// box + a streamed answer scoped to that single document (documentAsk). Reuses
// the shared useInferenceStream hook + ModelPicker. The `document_context` event
// confirms how much document text was loaded as context.
//
// Scoped to the active (tenant, context) by the bearer; the document id pins the
// answer to this document.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Drawer,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import { FormattedMessage, useIntl } from 'react-intl';

import { useActiveContextId, useActiveTenantId } from '../auth';
import { vectrosApiClient } from '../api/vectrosApi';
import type { Vectros } from '../api/vectrosApi';
import { ModelPicker } from './ModelPicker';
import { InferenceErrorAlert } from './InferenceErrorAlert';
import { useInferenceModels } from '../hooks/useInferenceModels';
import { useInferenceStream } from '../hooks/useInferenceStream';

interface DocumentAskDrawerProps {
  readonly open: boolean;
  readonly documentId: string;
  readonly documentTitle?: string | undefined;
  readonly onClose: () => void;
}

export function DocumentAskDrawer({
  open,
  documentId,
  documentTitle,
  onClose,
}: DocumentAskDrawerProps): React.JSX.Element {
  const tenant = useActiveTenantId();
  const context = useActiveContextId();
  const intl = useIntl();
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<string | undefined>(undefined);
  const { state, run, cancel, reset, isStreaming } = useInferenceStream();
  const modelsQuery = useInferenceModels();

  useEffect(() => {
    const def = modelsQuery.data?.defaultModel;
    if (model === undefined && def) setModel(def);
  }, [model, modelsQuery.data]);

  // Each time the drawer opens, start clean (no stale answer from a prior doc).
  useEffect(() => {
    if (open) {
      setPrompt('');
      reset();
    }
  }, [open, reset]);

  const ask = (): void => {
    const p = prompt.trim();
    if (p === '' || isStreaming) return;
    const request: Vectros.DocumentAskRequest = {
      id: documentId,
      prompt: p,
      ...(model !== undefined ? { model } : {}),
    };
    run(({ abortSignal }) =>
      vectrosApiClient(tenant, context).inference.documentAsk(request, { abortSignal }),
    );
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    // Ignore Enter mid-IME-composition (CJK etc.).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ask();
    }
  };

  const hasResult = isStreaming || state.text.length > 0 || state.status === 'error';

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { 'aria-label': intl.formatMessage({ id: 'ai.docAsk.title' }) } }}
    >
      <Stack spacing={2} sx={{ width: { xs: '100vw', sm: 420 }, p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
            <FormattedMessage id="ai.docAsk.title" />
          </Typography>
          <IconButton onClick={onClose} aria-label={intl.formatMessage({ id: 'ai.docAsk.close' })}>
            <CloseIcon />
          </IconButton>
        </Box>

        {documentTitle && documentTitle.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
            {documentTitle}
          </Typography>
        )}

        <ModelPicker value={model} onChange={setModel} disabled={isStreaming} />

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <TextField
            fullWidth
            multiline
            maxRows={4}
            size="small"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={intl.formatMessage({ id: 'ai.docAsk.placeholder' })}
            slotProps={{
              htmlInput: { 'aria-label': intl.formatMessage({ id: 'ai.docAsk.placeholder' }) },
            }}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <IconButton
              color="error"
              onClick={cancel}
              aria-label={intl.formatMessage({ id: 'ai.stop' })}
            >
              <StopIcon />
            </IconButton>
          ) : (
            <Button
              variant="contained"
              onClick={ask}
              disabled={prompt.trim() === ''}
              startIcon={<SendIcon />}
            >
              <FormattedMessage id="ai.docAsk.submit" />
            </Button>
          )}
        </Box>

        {!hasResult ? (
          <Alert severity="info">
            <FormattedMessage id="ai.docAsk.empty" />
          </Alert>
        ) : (
          <Box aria-live="polite" aria-busy={isStreaming || undefined}>
            {state.documentContext && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                <FormattedMessage
                  id="ai.docAsk.loaded"
                  values={{ bytes: state.documentContext.textBytes }}
                />
              </Typography>
            )}
            {/* Preserve any answer text streamed before a failure. */}
            {state.text.length > 0 && (
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {state.text}
              </Typography>
            )}
            {state.status === 'error' ? (
              <Box sx={{ mt: state.text.length > 0 ? 2 : 0 }}>
                <InferenceErrorAlert error={state.error}>
                  <FormattedMessage id="ai.docAsk.errorTitle" />
                </InferenceErrorAlert>
              </Box>
            ) : (
              state.text.length === 0 && (
                <Box
                  role="status"
                  sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}
                >
                  <CircularProgress size={16} />
                  <Typography variant="body2">
                    <FormattedMessage id="ai.thinking" />
                  </Typography>
                </Box>
              )
            )}
          </Box>
        )}
      </Stack>
    </Drawer>
  );
}
