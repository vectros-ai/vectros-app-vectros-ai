/**
 * The extra header a presigned upload URL requires, as named by the upload response.
 *
 * The platform can bake an S3 conditional-write precondition (for example `If-None-Match: *`,
 * which makes the URL single-use) into the URL's own signature. A PUT that omits that header, or
 * changes its value, fails signature validation with a 403 before the bytes are accepted. The
 * response names the header in `requiredHeaderName` / `requiredHeaderValue`.
 *
 * Read from the response, never hard-coded, and only when the response carries a name: an API
 * version that does not return these fields gets no extra header, exactly as before. The fields
 * are read off the raw response rather than a typed property because the client library in use
 * may predate them.
 */
export function presignedUploadHeaders(response: unknown): Record<string, string> {
  if (typeof response !== 'object' || response === null) return {};
  const { requiredHeaderName, requiredHeaderValue } = response as {
    requiredHeaderName?: unknown;
    requiredHeaderValue?: unknown;
  };
  if (typeof requiredHeaderName !== 'string' || requiredHeaderName === '') return {};
  if (typeof requiredHeaderValue !== 'string') return {};
  return { [requiredHeaderName]: requiredHeaderValue };
}
