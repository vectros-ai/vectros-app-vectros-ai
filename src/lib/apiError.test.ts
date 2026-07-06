// ---------------------------------------------------------------------------
// apiError tests — duck-typing the error envelope without importing
// the SDK's error classes. Covers the present/absent/malformed branches that
// decide whether the UI shows a support reference line.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { extractRequestId, statusCodeOf } from './apiError';

describe('extractRequestId', () => {
  it('reads requestId from a well-formed error envelope', () => {
    const err = { statusCode: 500, body: { message: 'Internal error', requestId: 'corr-abc-123' } };
    expect(extractRequestId(err)).toBe('corr-abc-123');
  });

  it('returns undefined when the body has no requestId', () => {
    expect(extractRequestId({ statusCode: 400, body: { message: 'Bad request' } })).toBeUndefined();
  });

  it('returns undefined for an empty-string requestId', () => {
    expect(extractRequestId({ body: { requestId: '' } })).toBeUndefined();
  });

  it('returns undefined for a non-string requestId', () => {
    expect(extractRequestId({ body: { requestId: 42 } })).toBeUndefined();
  });

  it('returns undefined when there is no body (network/abort error)', () => {
    expect(extractRequestId(new Error('Network down'))).toBeUndefined();
  });

  it('returns undefined for null / non-object / undefined', () => {
    expect(extractRequestId(null)).toBeUndefined();
    expect(extractRequestId(undefined)).toBeUndefined();
    expect(extractRequestId('boom')).toBeUndefined();
    expect(extractRequestId({ body: null })).toBeUndefined();
  });
});

describe('statusCodeOf', () => {
  it('reads a numeric statusCode', () => {
    expect(statusCodeOf({ statusCode: 409 })).toBe(409);
  });

  it('returns undefined when absent or non-numeric', () => {
    expect(statusCodeOf({})).toBeUndefined();
    expect(statusCodeOf({ statusCode: '409' })).toBeUndefined();
    expect(statusCodeOf(null)).toBeUndefined();
  });
});
