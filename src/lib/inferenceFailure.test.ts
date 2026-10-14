import { describe, expect, it } from 'vitest';
import { createIntl } from 'react-intl';

import messages from '../i18n/messages.en.json';
import { statusError } from '../test/statusError';
import { explainProviderFailure } from './inferenceFailure';

const intl = createIntl({ locale: 'en', messages });

function messageOf(err: unknown): string {
  expect(err).toBeInstanceOf(Error);
  return (err as Error).message;
}

describe('the test fixture', () => {
  it('is the real SDK error: a dump message, a numeric statusCode and the parsed body', () => {
    const err = statusError(403, { message: 'nope' }) as Error & {
      statusCode?: unknown;
      body?: unknown;
    };
    expect(err.statusCode).toBe(403);
    expect(err.body).toEqual({ message: 'nope' });
    // The dump the screen must never show.
    expect(err.message).toMatch(/Status code: 403/);
  });
});

describe('explainProviderFailure', () => {
  it('explains a 403 without the raw dump or the API wording, and does not blame the alias alone', () => {
    const out = messageOf(
      explainProviderFailure(
        statusError(403, {
          message: 'Provider alias x requires a granted waiver this account does not hold.',
        }),
        intl,
        false,
      ),
    );
    expect(out).toBe(messages['ai.route.error.forbidden']);
    expect(out).not.toMatch(/Status code|Body:|granted waiver|Forbidden/);
    // A 403 can also come from a token or access limit: the text must say so.
    expect(out).toMatch(/otherwise your access may not allow/i);
    // The second reason: a Business Associate Agreement holder is also refused until an owner attests the config.
    expect(out).toMatch(/Business Associate Agreement/);
    expect(out).toMatch(/attested that provider configuration in the developer portal/);
  });

  it('gives the same 403 text for any body and whether or not a provider model was typed', () => {
    for (const body of [
      { message: 'Token scope does not permit inference operations.' },
      undefined,
      'plain text',
    ]) {
      for (const typed of [true, false]) {
        expect(messageOf(explainProviderFailure(statusError(403, body), intl, typed))).toBe(
          messages['ai.route.error.forbidden'],
        );
      }
    }
  });

  describe('400', () => {
    it('with no provider model typed: shows the API message, then the model hint as a possibility', () => {
      const out = messageOf(
        explainProviderFailure(
          statusError(400, { message: "'search.limit' must be between 1 and 20" }),
          intl,
          false,
        ),
      );
      expect(out).toBe(
        `'search.limit' must be between 1 and 20. ${messages['ai.route.error.modelHint']}`,
      );
    });

    it('does not double a sentence end when the API message already has one', () => {
      const out = messageOf(
        explainProviderFailure(statusError(400, { message: 'No model was named.' }), intl, false),
      );
      expect(out).toBe(`No model was named. ${messages['ai.route.error.modelHint']}`);
    });

    it('with no provider model typed and no API message: the fixed missing-model text', () => {
      for (const body of [undefined, {}, { message: '   ' }, { message: 7 }]) {
        expect(messageOf(explainProviderFailure(statusError(400, body), intl, false))).toBe(
          messages['ai.route.error.noModel'],
        );
      }
    });

    it('with a provider model typed: only the API message, never the missing-model hint', () => {
      const out = messageOf(
        explainProviderFailure(statusError(400, { message: 'query is required' }), intl, true),
      );
      expect(out).toBe('query is required');
    });

    it('with a provider model typed and no API message: the neutral line', () => {
      expect(messageOf(explainProviderFailure(statusError(400, undefined), intl, true))).toBe(
        'The request failed (status 400).',
      );
    });
  });

  describe('other statuses', () => {
    it.each([401, 402, 404, 409, 413, 429, 500, 502, 503])(
      'status %i: shows the API message when it sent one',
      (status) => {
        expect(
          messageOf(
            explainProviderFailure(statusError(status, { message: 'Because.' }), intl, false),
          ),
        ).toBe('Because.');
      },
    );

    it.each([401, 404, 409, 413])(
      'status %i with no message: a neutral line without "try again"',
      (status) => {
        const out = messageOf(explainProviderFailure(statusError(status, { x: 1 }), intl, false));
        expect(out).toBe(`The request failed (status ${status}).`);
        expect(out).not.toMatch(/try again|provider/i);
      },
    );

    it.each([429, 500, 502, 503])(
      'status %i with no message: a neutral line that says to try again',
      (status) => {
        expect(messageOf(explainProviderFailure(statusError(status, undefined), intl, false))).toBe(
          `The request failed (status ${status}). Please try again.`,
        );
      },
    );

    it('never shows a raw body or the SDK dump', () => {
      const out = messageOf(
        explainProviderFailure(statusError(502, { unexpected: ['shape'] }), intl, false),
      );
      expect(out).not.toMatch(/Status code|Body:|unexpected|VectrosError/);
    });
  });

  it('returns an error with no status code (cancelled request, network failure) unchanged', () => {
    const abort = new DOMException('aborted', 'AbortError');
    expect(explainProviderFailure(abort, intl, false)).toBe(abort);
    const net = new TypeError('Failed to fetch');
    expect(explainProviderFailure(net, intl, false)).toBe(net);
  });
});
