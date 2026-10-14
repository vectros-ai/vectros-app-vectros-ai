// ---------------------------------------------------------------------------
// inferenceFailure — turn a refused provider-routed call into a readable error.
//
// A request the API rejects before any stream starts (an alias it will not use,
// a missing model) is thrown by the SDK as an error whose own message is a
// multi-line dump: the class name, `Status code: 403`, and the JSON body. The
// stream hook keeps only that message, so without this the screen would print
// the dump. Only provider-routed calls pass through here; the platform path is
// left exactly as it was.
// ---------------------------------------------------------------------------

import type { IntlShape } from 'react-intl';
import { extractErrorMessage, statusCodeOf } from '@vectros-ai/react';

/** Ends a sentence already (so a following sentence can be appended as is). */
const ENDS_SENTENCE = /[.!?]$/;

/**
 * Explain a failure from a provider-routed call.
 *
 * A status code alone does not say why a call was refused, so the wording
 * names the likely cause without claiming it:
 *
 *  - 403: an alias that is unknown or inactive (a malformed alias is simply
 *    unknown), or a missing risk waiver, but also a token or access limit
 *    unrelated to the alias. The API's own wording names internal waiver
 *    detail, so this states the checks a person can act on instead.
 *  - 400 with no provider model typed: the API's own message when it sent one,
 *    followed by the hint that the provider configuration may have no default
 *    model (a 400 has many causes, so the hint is a possibility, not the
 *    diagnosis); the fixed missing-model text only when the body has no message.
 *  - any other status: the API's own message when it sent one, otherwise a
 *    neutral line carrying the status. The raw SDK dump is never shown.
 *
 * Anything that carries no status code (a cancelled request, a network failure)
 * is returned unchanged.
 */
export function explainProviderFailure(
  err: unknown,
  intl: IntlShape,
  providerModelTyped: boolean,
): unknown {
  const status = statusCodeOf(err);
  if (status === undefined) return err;
  if (status === 403) {
    return new Error(intl.formatMessage({ id: 'ai.route.error.forbidden' }));
  }
  const detail = extractErrorMessage(err);
  if (status === 400 && !providerModelTyped) {
    if (detail === undefined) {
      return new Error(intl.formatMessage({ id: 'ai.route.error.noModel' }));
    }
    const hint = intl.formatMessage({ id: 'ai.route.error.modelHint' });
    return new Error(`${ENDS_SENTENCE.test(detail) ? detail : `${detail}.`} ${hint}`);
  }
  if (detail !== undefined) return new Error(detail);
  const retryable = status === 429 || status >= 500;
  return new Error(
    intl.formatMessage(
      { id: retryable ? 'ai.route.error.genericRetry' : 'ai.route.error.generic' },
      { status },
    ),
  );
}
