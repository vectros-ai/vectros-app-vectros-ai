import { describe, expect, it } from 'vitest';

import { presignedUploadHeaders } from './presignedUpload';

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
