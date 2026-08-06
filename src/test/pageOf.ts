// ---------------------------------------------------------------------------
// pageOf — test helpers for the `{ data, nextCursor }` page envelope every list
// endpoint returns (the auth enumerations, the record lookup, folders,
// documents, schemas). `pageOf` builds a single, FINAL page (`nextCursor: null`)
// — what most fixtures want. `pageOfWithCursor` builds a NON-final page, and
// `sealedPager` builds a multi-page fetcher that enforces the real cursor
// contract. Keeps the mocks faithful to the SDK shape so the `.data` unwrap /
// drainPages paths are actually exercised.
// ---------------------------------------------------------------------------

/** A single, FINAL page — no more rows behind it. */
export function pageOf<T>(data: readonly T[]): {
  data: readonly T[];
  nextCursor: null;
} {
  return { data, nextCursor: null };
}

/**
 * A NON-final page: `data` plus a live cursor. `data` may be short or empty and
 * still carry a live cursor — server-side filtering runs per page after that
 * page's cursor is captured, so that combination is normal, not a contradiction.
 */
export function pageOfWithCursor<T>(
  data: readonly T[],
  nextCursor: string,
): {
  data: readonly T[];
  nextCursor: string;
} {
  return { data, nextCursor };
}

/**
 * An opaque cursor in the wire form the API actually mints — a version tag plus
 * an authenticated blob. The point for a test is what it is NOT: it is not
 * derivable from any item in the page, so a paginator that invents a cursor
 * from row data cannot produce it.
 */
export function sealedCursor(page: number): string {
  return `v1.${btoa(`nonce-${page}|ciphertext|tag`)}`;
}

/** One page of a `sealedPager` fixture. The LAST entry is the terminal page. */
export interface SealedPage<T> {
  readonly items: readonly T[];
}

/**
 * Build a `fetchPage` over fixed pages that ENFORCES the cursor contract: each
 * non-final page hands out an opaque `sealedCursor`, and the fetcher rejects any
 * `startFrom` it did not itself mint — exactly as the API does, which
 * authenticates the cursor and answers a fabricated one with a 400. A paginator
 * that pages by row id therefore fails here rather than quietly resuming from
 * the wrong place.
 */
export function sealedPager<T>(pages: ReadonlyArray<SealedPage<T>>): {
  fetchPage: (startFrom: string | undefined) => Promise<{
    data: readonly T[];
    nextCursor: string | null;
  }>;
  /** Every `startFrom` the paginator sent, in order (`undefined` = first page). */
  calls: Array<string | undefined>;
} {
  const calls: Array<string | undefined> = [];
  const fetchPage = (
    startFrom: string | undefined,
  ): Promise<{ data: readonly T[]; nextCursor: string | null }> => {
    calls.push(startFrom);
    // The cursor a caller sends must be one we minted: `undefined` opens the
    // listing, and `sealedCursor(n)` resumes at page n.
    const index =
      startFrom === undefined ? 0 : pages.findIndex((_, i) => sealedCursor(i) === startFrom);
    if (index < 0) {
      return Promise.reject(
        new Error(
          `400 invalid_cursor: ${JSON.stringify(startFrom)} is not a cursor this API issued`,
        ),
      );
    }
    const page = pages[index];
    if (!page) {
      return Promise.reject(new Error(`400 invalid_cursor: no page ${index}`));
    }
    return Promise.resolve({
      data: page.items,
      nextCursor: index === pages.length - 1 ? null : sealedCursor(index + 1),
    });
  };
  return { fetchPage, calls };
}
