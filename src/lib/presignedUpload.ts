/**
 * The headers a presigned upload URL requires, as named by the upload response.
 *
 * An upload that sent `size` is bound: the URL is signed for an exact length and `Content-Type`, and the response's
 * `requiredHeaders` map carries every header the PUT must send, that `Content-Type` among them (the media type as stored, which can
 * differ from the `fileType` sent). The platform can also bake an S3 conditional-write precondition (for example
 * `If-None-Match: *`, which makes the URL single-use) into the signature. A PUT that omits one of these, or changes its value, fails
 * signature validation with a 403 before the bytes are accepted.
 *
 * The map is used when present; otherwise the older single `requiredHeaderName` / `requiredHeaderValue` pair, so an API version that
 * does not return the map still works. Read off the raw response and checked at runtime, never hard-coded.
 */
export function presignedUploadHeaders(response: unknown): Record<string, string> {
  if (typeof response !== 'object' || response === null) return {};
  const { requiredHeaders, requiredHeaderName, requiredHeaderValue } = response as {
    requiredHeaders?: unknown;
    requiredHeaderName?: unknown;
    requiredHeaderValue?: unknown;
  };
  if (
    typeof requiredHeaders === 'object' &&
    requiredHeaders !== null &&
    !Array.isArray(requiredHeaders)
  ) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(requiredHeaders as Record<string, unknown>)) {
      if (k !== '' && typeof v === 'string') out[k] = v;
    }
    if (Object.keys(out).length > 0) return out;
  }
  if (typeof requiredHeaderName !== 'string' || requiredHeaderName === '') return {};
  if (typeof requiredHeaderValue !== 'string') return {};
  return { [requiredHeaderName]: requiredHeaderValue };
}

/**
 * The PUT's headers: the required ones, and `Content-Type: fileType` only when they do not name a `Content-Type` themselves (in any
 * letter case: two spellings of one header would be sent as one combined value, which no signature matches).
 */
export function presignedPutHeaders(response: unknown, fileType: string): Record<string, string> {
  const required = presignedUploadHeaders(response);
  const namesContentType = Object.keys(required).some((k) => k.toLowerCase() === 'content-type');
  return namesContentType ? required : { 'Content-Type': fileType, ...required };
}
