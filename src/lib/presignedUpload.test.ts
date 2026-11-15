import { describe, expect, it } from 'vitest';

import { presignedPutHeaders, presignedUploadHeaders } from './presignedUpload';

describe('presignedUploadHeaders', () => {
  it('returns the header the response names, with its exact value', () => {
    expect(
      presignedUploadHeaders({
        uploadUrl: 'https://s3.example/put',
        requiredHeaderName: 'If-None-Match',
        requiredHeaderValue: '*',
      }),
    ).toEqual({ 'If-None-Match': '*' });
  });

  it('uses whatever header name the response carries rather than a fixed one', () => {
    expect(
      presignedUploadHeaders({ requiredHeaderName: 'If-Match', requiredHeaderValue: '"etag-1"' }),
    ).toEqual({ 'If-Match': '"etag-1"' });
  });

  it('returns no header when the response names none', () => {
    expect(presignedUploadHeaders({ uploadUrl: 'https://s3.example/put' })).toEqual({});
  });

  it('returns no header for a blank or non-string name, or a missing value', () => {
    expect(presignedUploadHeaders({ requiredHeaderName: '', requiredHeaderValue: '*' })).toEqual({});
    expect(presignedUploadHeaders({ requiredHeaderName: 42, requiredHeaderValue: '*' })).toEqual({});
    expect(presignedUploadHeaders({ requiredHeaderName: 'If-None-Match' })).toEqual({});
  });

  it('returns no header for a non-object response', () => {
    expect(presignedUploadHeaders(undefined)).toEqual({});
    expect(presignedUploadHeaders(null)).toEqual({});
  });
});

describe('requiredHeaders (a bound upload)', () => {
  it('prefers the requiredHeaders map over the single pair, and falls back to the pair', () => {
    expect(
      presignedUploadHeaders({
        requiredHeaders: { 'Content-Type': 'image/png', 'If-None-Match': '*' },
        requiredHeaderName: 'If-None-Match',
        requiredHeaderValue: '*',
      }),
    ).toEqual({ 'Content-Type': 'image/png', 'If-None-Match': '*' });
    expect(presignedUploadHeaders({ requiredHeaders: {}, requiredHeaderName: 'If-None-Match', requiredHeaderValue: '*' })).toEqual({
      'If-None-Match': '*',
    });
    expect(presignedUploadHeaders({ requiredHeaders: { a: 1, '': 'x' } })).toEqual({});
  });

  it('sends the signed Content-Type instead of fileType, never two spellings of it', () => {
    expect(presignedPutHeaders({ requiredHeaders: { 'content-type': 'image/png' } }, 'application/octet-stream')).toEqual({
      'content-type': 'image/png',
    });
    expect(presignedPutHeaders({ requiredHeaderName: 'If-None-Match', requiredHeaderValue: '*' }, 'application/pdf')).toEqual({
      'Content-Type': 'application/pdf',
      'If-None-Match': '*',
    });
    expect(presignedPutHeaders(undefined, 'text/plain')).toEqual({ 'Content-Type': 'text/plain' });
  });
});

