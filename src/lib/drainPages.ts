// ---------------------------------------------------------------------------
// drainPages — exhaustively page a cursor-paginated Vectros SDK list endpoint.
//
// As of SDK 0.23 the list endpoints return the `{ data, nextCursor }`
// page envelope (default 20 items/page); callers unwrap `.data` and hand this
// paginator the bare item array. We follow the documented `startFrom` cursor =
// the last item's `id` (via `cursorOf`) rather than the opaque `nextCursor`,
// which keeps the same drain shape the auth lists used pre-0.23. Enumerations
// that must be complete — the context switcher, the folder tree, the document
// list — would silently lose everything past the first page without draining.
// This is the one shared paginator both the auth layer (CurrentContextProvider)
// and the data pages use.
// ---------------------------------------------------------------------------

/** Default safety ceiling on pages drained (guards a non-advancing cursor). */
const DEFAULT_MAX_PAGES = 50;

/**
 * Drain every page of a cursor-paginated list endpoint.
 *
 * `fetchPage(startFrom)` returns one page (≤ `pageSize` items); we follow
 * `startFrom` = the last item's cursor (via `cursorOf`) until a short page (the
 * last one) or the cursor stops advancing (defensive — a non-advancing cursor
 * would otherwise loop). Bounded by `maxPages`.
 *
 * @param fetchPage fetch a single page given the previous page's cursor (omit on the first page)
 * @param cursorOf  extract the pagination cursor (typically `id`) from an item
 * @param pageSize  the page size requested — a returned page shorter than this ends the drain
 * @param maxPages  hard ceiling on pages (default 50)
 */
export async function drainPages<T>(
  fetchPage: (startFrom: string | undefined) => Promise<ReadonlyArray<T>>,
  cursorOf: (item: T) => string | undefined,
  pageSize: number,
  maxPages: number = DEFAULT_MAX_PAGES,
): Promise<T[]> {
  const all: T[] = [];
  let startFrom: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const items = await fetchPage(startFrom);
    all.push(...items);
    if (items.length < pageSize) break;
    const last = items[items.length - 1];
    const cursor = last ? cursorOf(last) : undefined;
    if (!cursor || cursor === startFrom) break; // no progress → stop (defensive)
    startFrom = cursor;
  }
  return all;
}
