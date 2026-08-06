// ---------------------------------------------------------------------------
// drainPages tests — the shared cursor-paginator used by the auth layer and the
// folder/document/context enumerations. A regression here silently truncates or
// hangs enumeration, so the fixtures ENFORCE the real cursor contract
// (`sealedPager` rejects any `startFrom` the API did not itself mint) rather
// than accepting whatever the paginator invents. Every shape is covered: the
// single terminal page, a multi-page drain, a FULL page that is nonetheless
// terminal, the short and the EMPTY page that each still carry a live cursor,
// an absent `data` field, and the maxPages ceiling.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import type { CursorPage } from './drainPages';
import { drainPages } from './drainPages';
import { sealedCursor, sealedPager } from '../test/pageOf';

interface Item {
  readonly id: string;
}

const ids = (items: ReadonlyArray<Item>): string[] => items.map((i) => i.id);

describe('drainPages', () => {
  it('returns an empty listing (no items, null cursor) without a second fetch', async () => {
    // The most common production shape — a new tenant with no folders yet.
    const { fetchPage, calls } = sealedPager<Item>([{ items: [] }]);

    const result = await drainPages(fetchPage);

    expect(result).toEqual([]);
    expect(calls).toEqual([undefined]);
  });

  it('returns a single terminal page without asking for another', async () => {
    const { fetchPage, calls } = sealedPager<Item>([{ items: [{ id: 'a' }, { id: 'b' }] }]);

    const result = await drainPages(fetchPage);

    expect(ids(result)).toEqual(['a', 'b']);
    expect(calls).toEqual([undefined]);
  });

  it('drains multiple pages, echoing each opaque nextCursor back verbatim', async () => {
    // The fixture rejects any startFrom it did not mint, so this passes only if
    // the paginator hands the envelope's cursor straight back — an id derived
    // from the page's own rows earns a 400.
    const { fetchPage, calls } = sealedPager<Item>([
      { items: [{ id: 'a' }, { id: 'b' }] },
      { items: [{ id: 'c' }, { id: 'd' }] },
      { items: [{ id: 'e' }] },
    ]);

    const result = await drainPages(fetchPage);

    expect(ids(result)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(calls).toEqual([undefined, sealedCursor(1), sealedCursor(2)]);
  });

  it('CONTINUES through an EMPTY page that still carries a live cursor', async () => {
    // The case that decides correctness. Server-side filtering runs per page
    // AFTER that page's cursor is captured, so a scope-enforced credential
    // routinely sees a page with every row filtered out and rows still behind
    // it. Stopping here is the silent truncation this paginator exists to
    // prevent.
    const { fetchPage, calls } = sealedPager<Item>([
      { items: [{ id: 'a' }, { id: 'b' }] },
      { items: [] },
      { items: [{ id: 'c' }] },
    ]);

    const result = await drainPages(fetchPage);

    expect(ids(result)).toEqual(['a', 'b', 'c']);
    expect(calls).toHaveLength(3);
  });

  it('CONTINUES through a short page that still carries a live cursor', async () => {
    const { fetchPage } = sealedPager<Item>([
      { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
      { items: [{ id: 'd' }] }, // shorter than page 1 — but not terminal
      { items: [{ id: 'e' }, { id: 'f' }] },
    ]);

    const result = await drainPages(fetchPage);

    expect(ids(result)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('stops on a FULL final page (a null cursor, not the item count, terminates)', async () => {
    // The mirror of the case above: page fullness carries no information about
    // whether more rows follow, in either direction.
    const { fetchPage, calls } = sealedPager<Item>([
      { items: [{ id: 'a' }, { id: 'b' }] },
      { items: [{ id: 'c' }, { id: 'd' }] }, // same size as page 1, and terminal
    ]);

    const result = await drainPages(fetchPage);

    expect(ids(result)).toEqual(['a', 'b', 'c', 'd']);
    expect(calls).toEqual([undefined, sealedCursor(1)]);
  });

  it('tolerates a page with no data field and keeps draining on its cursor', async () => {
    const fetchPage = vi
      .fn<(startFrom: string | undefined) => Promise<CursorPage<Item>>>()
      .mockResolvedValueOnce({ nextCursor: sealedCursor(1) })
      .mockResolvedValueOnce({ data: [{ id: 'a' }], nextCursor: null });

    const result = await drainPages(fetchPage);

    expect(ids(result)).toEqual(['a']);
    expect(fetchPage).toHaveBeenNthCalledWith(2, sealedCursor(1));
  });

  it('treats an empty-string cursor as exhaustion rather than echoing it back', async () => {
    const fetchPage = vi
      .fn<(startFrom: string | undefined) => Promise<CursorPage<Item>>>()
      .mockResolvedValue({ data: [{ id: 'a' }], nextCursor: '' });

    await expect(drainPages(fetchPage)).resolves.toEqual([{ id: 'a' }]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('drains a listing of exactly maxPages full pages — the terminal probe is not counted against the bound', async () => {
    // The boundary that decides whether the safety valve eats a COMPLETE read.
    // A full last page still carries a live cursor (the server sets one
    // whenever it stops on `limit`), so proving exhaustion costs one request
    // beyond the last page of data. Bounding requests instead of pages fails
    // here — at exactly `maxPages × limit` rows, the roundest number there is.
    const { fetchPage, calls } = sealedPager<Item>([
      { items: [{ id: 'a' }, { id: 'b' }] },
      { items: [{ id: 'c' }, { id: 'd' }] },
      { items: [{ id: 'e' }, { id: 'f' }] },
      { items: [] }, // the probe: empty, and terminal
    ]);

    await expect(drainPages(fetchPage, 3)).resolves.toHaveLength(6);
    expect(calls).toHaveLength(4);
  });

  it('THROWS at the maxPages ceiling rather than returning a partial result', async () => {
    // A cursor that never goes null. Returning what we managed to read would be
    // exactly the silent truncation the drain replaces, so it fails closed —
    // and the message carries both numbers, because "4 items over 4 requests"
    // and "0 items over 4 requests" are different incidents.
    let n = 0;
    const fetchPage = vi
      .fn<(startFrom: string | undefined) => Promise<CursorPage<Item>>>()
      .mockImplementation(() =>
        Promise.resolve({ data: [{ id: `id-${n}` }], nextCursor: sealedCursor(++n) }),
      );

    // maxPages 3 → 3 pages of data plus the terminal probe = 4 requests.
    await expect(drainPages(fetchPage, 3)).rejects.toThrow(
      /still not exhausted after 4 requests \(4 items\)/,
    );
    expect(fetchPage).toHaveBeenCalledTimes(4);
  });

  it('reports zero items in the ceiling error when every page came back empty', async () => {
    // The pathology the page bound exists for: the cursor advances while the
    // item count never grows, which is what makes a row-based bound unreachable.
    let n = 0;
    const fetchPage = vi
      .fn<(startFrom: string | undefined) => Promise<CursorPage<Item>>>()
      .mockImplementation(() => Promise.resolve({ data: [], nextCursor: sealedCursor(++n) }));

    await expect(drainPages(fetchPage, 4)).rejects.toThrow(
      /still not exhausted after 5 requests \(0 items\)/,
    );
  });

  it('propagates a rejected page fetch to the caller', async () => {
    const fetchPage = vi
      .fn<(startFrom: string | undefined) => Promise<CursorPage<Item>>>()
      .mockRejectedValue(new Error('400 invalid_cursor'));

    await expect(drainPages(fetchPage)).rejects.toThrow('400 invalid_cursor');
  });
});
