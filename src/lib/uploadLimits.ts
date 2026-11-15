// ---------------------------------------------------------------------------
// Shared upload limits — one place for the client-side file-size guard used by
// every upload path (add document, replace file).
// ---------------------------------------------------------------------------

/**
 * Mirrors the backend's max file size (100 MiB). The upload request names the
 * file's size and the API refuses a larger one, but checking here first gives
 * the user the reason before any request is made.
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
