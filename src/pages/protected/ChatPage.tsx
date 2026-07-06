// ---------------------------------------------------------------------------
// ChatPage — `/ai/chat`, the multi-turn chat surface. A client-
// side message thread (no server-side history — non-goal), a composer, and
// the shared ModelPicker. Each send forwards the whole thread as a ChatRequest
// and streams the reply via useInferenceStream; the in-progress answer renders
// live, then commits to the thread on `done`. A Stop button cancels (real:
// the backend bills only streamed tokens).
//
// Inside RequireContext (mounted under AiWorkspaceLayout), so the active
// (tenant, context) is resolved and scopes the inference call via the bearer.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import { FormattedMessage, useIntl } from 'react-intl';

import { useActiveContextId, useActiveTenantId } from '../../auth';
import { vectrosApiClient } from '../../api/vectrosApi';
import type { Vectros } from '../../api/vectrosApi';
import { ModelPicker } from '../../components/ModelPicker';
import { InferenceErrorAlert } from '../../components/InferenceErrorAlert';
import { useInferenceModels } from '../../hooks/useInferenceModels';
import { useInferenceStream } from '../../hooks/useInferenceStream';

interface ChatTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** A single chat bubble, aligned by role. (Prop is `turn`, not `role` — the
 *  latter reads as an ARIA role attribute to jsx-a11y.) */
function Bubble({ turn }: { readonly turn: ChatTurn }): React.JSX.Element {
  const { role, content } = turn;
  const isUser = role === 'user';
  return (
    <Box sx={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <Paper
        variant="outlined"
        sx={{
          px: 2,
          py: 1,
          maxWidth: '80%',
          bgcolor: isUser ? 'primary.main' : 'background.paper',
          color: isUser ? 'primary.contrastText' : 'text.primary',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        <Typography variant="caption" sx={{ display: 'block', opacity: 0.7, mb: 0.5 }}>
          <FormattedMessage id={isUser ? 'ai.roleYou' : 'ai.roleAssistant'} />
        </Typography>
        <Typography variant="body2">{content}</Typography>
      </Paper>
    </Box>
  );
}

export function ChatPage(): React.JSX.Element {
  const tenant = useActiveTenantId();
  const context = useActiveContextId();
  const intl = useIntl();
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState<string | undefined>(undefined);
  const { state, run, cancel, reset, isStreaming } = useInferenceStream();
  const modelsQuery = useInferenceModels();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Seed the model from the registry default once it loads.
  useEffect(() => {
    const def = modelsQuery.data?.defaultModel;
    if (model === undefined && def) setModel(def);
  }, [model, modelsQuery.data]);

  // Commit the streamed answer to the thread when a run completes, then reset.
  // Skip a content-less reply (e.g. an empty model response) — no blank bubble.
  useEffect(() => {
    if (state.status === 'done') {
      const content = state.text;
      if (content.length > 0) {
        setMessages((prev) => [...prev, { role: 'assistant', content }]);
      }
      reset();
    }
  }, [state.status, state.text, reset]);

  // Keep the latest message in view. (Optional-call: jsdom has no scrollIntoView.)
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, state.text, isStreaming]);

  const send = (): void => {
    const text = input.trim();
    if (text === '' || isStreaming) return;
    const next: ChatTurn[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    const request: Vectros.ChatRequest = {
      messages: next.map((m) => ({ role: m.role, content: m.content })),
      ...(model !== undefined ? { model } : {}),
    };
    run(({ abortSignal }) =>
      vectrosApiClient(tenant, context).inference.chatInference(request, { abortSignal }),
    );
  };

  const onComposerKeyDown = (e: React.KeyboardEvent): void => {
    // Ignore Enter mid-IME-composition (CJK etc.) so a candidate-confirm Enter
    // doesn't send a half-composed message.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const isEmpty = messages.length === 0 && !isStreaming && state.status !== 'error';

  return (
    <Stack spacing={2}>
      <Box sx={{ alignSelf: 'flex-start' }}>
        <ModelPicker value={model} onChange={setModel} disabled={isStreaming} />
      </Box>

      <Stack spacing={1.5} sx={{ minHeight: 200 }}>
        {isEmpty ? (
          <Alert severity="info">
            <FormattedMessage id="ai.chat.empty" />
          </Alert>
        ) : (
          messages.map((m, i) => <Bubble key={i} turn={m} />)
        )}

        {/* Live region: the in-progress answer, thinking indicator, and any
            terminal error are announced as they update. */}
        <Box aria-live="polite" aria-busy={isStreaming || undefined}>
          <Stack spacing={1.5}>
            {isStreaming &&
              (state.text.length > 0 ? (
                <Bubble turn={{ role: 'assistant', content: state.text }} />
              ) : (
                <Box
                  role="status"
                  sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}
                >
                  <CircularProgress size={16} />
                  <Typography variant="body2">
                    <FormattedMessage id="ai.thinking" />
                  </Typography>
                </Box>
              ))}

            {state.status === 'error' && (
              <>
                {/* Preserve any tokens already streamed before the failure. */}
                {state.text.length > 0 && (
                  <Bubble turn={{ role: 'assistant', content: state.text }} />
                )}
                <InferenceErrorAlert error={state.error}>
                  <FormattedMessage id="ai.chat.errorTitle" />
                </InferenceErrorAlert>
              </>
            )}
          </Stack>
        </Box>
        <div ref={bottomRef} />
      </Stack>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
        <TextField
          fullWidth
          multiline
          maxRows={6}
          size="small"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onComposerKeyDown}
          placeholder={intl.formatMessage({ id: 'ai.chat.placeholder' })}
          slotProps={{
            htmlInput: { 'aria-label': intl.formatMessage({ id: 'ai.chat.placeholder' }) },
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
            onClick={send}
            disabled={input.trim() === ''}
            startIcon={<SendIcon />}
          >
            <FormattedMessage id="ai.chat.send" />
          </Button>
        )}
      </Box>
    </Stack>
  );
}
