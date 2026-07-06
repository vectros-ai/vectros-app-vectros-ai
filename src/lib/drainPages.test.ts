// ---------------------------------------------------------------------------
// drainPages tests — the shared cursor-paginator used by the auth layer and the
// folder/document/context enumerations. A regression here silently truncates or
// hangs enumeration, so every termination branch is covered: short-page stop,
// the non-advancing-cursor guard, the maxPages ceiling, the empty first page,
// and an absent cursor.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import { drainPages } from './drainPages';

interface Item {
  readonly id: string;
}

/** Build a fetchPage backed by fixed pages, recording the cursors it was called with. */
function pagedFetcher(pages: ReadonlyArray<ReadonlyArray<Item>>): {
  fetchPage: (startFrom: string | undefined) => Promise<ReadonlyArray<Item>>;
  calls: Array<string | undefined>;
} {
  const calls: Array<string | undefined> = [];
  let index = 0;
  const fetchPage = (startFrom: string | undefined): Promise<ReadonlyArray<Item>> => {
    calls.push(startFrom);
    const page = pages[index] ?? [];
    index++;
    return Promise.resolve(page);
  };
  return { fetchPage, calls };
}

const cursorOf = (i: Item): string | undefined => i.id;

describe('drainPages', () => {
  it('stops after a short final page and returns all items in order', async () => {
    const { fetchPage, calls } = pagedFetcher([
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'c' }], // short page (< pageSize) → terminal
    ]);
    const result = await drainPages(fetchPage, cursorOf, 2);
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    // First page no cursor; second page seeded from the last item of page 1.
    expect(calls).toEqual([undefined, 'b']);
  });

  it('returns a single full page when the next page is empty', async () => {
    const { fetchPage, calls } = pagedFetcher([[{ id: 'a' }, { id: 'b' }], []]);
    const result = await drainPages(fetchPage, cursorOf, 2);
    expect(result.map((i) => i.id)).toEqual(['a', 'b']);
    expect(calls).toEqual([undefined, 'b']);
  });

  it('handles an empty first page', async () => {
    const { fetchPage, calls } = pagedFetcher([[]]);
    const result = await drainPages(fetchPage, cursorOf, 2);
    expect(result).toEqual([]);
    expect(calls).toEqual([undefined]);
  });

  it('stops when the cursor does not advance (defensive against a loop)', async () => {
    // Every page is full and ends with the SAME id → cursor never advances.
    let count = 0;
    const fetchPage = vi.fn().mockImplementation(() => {
      count++;
      return Promise.resolve([{ id: 'x' }, { id: 'stuck' }]);
    });
    const result = await drainPages(fetchPage, cursorOf, 2);
    // Page 1 (startFrom undefined) accepted; page 2 (startFrom 'stuck') is full
    // but ends with the same 'stuck' cursor → stop.
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(count).toBe(2);
    expect(result).toHaveLength(4);
  });

  it('stops when the last item has no cursor', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'a' }, { id: undefined } as unknown as Item]);
    const result = await drainPages(fetchPage, cursorOf, 2);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
  });

  it('honors the maxPages ceiling', async () => {
    // Always returns a full, advancing page → only maxPages stops it.
    let n = 0;
    const fetchPage = vi.fn().mockImplementation(() => Promise.resolve([{ id: `id-${n++}` }]));
    const result = await drainPages(fetchPage, cursorOf, 1, 3);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(3);
  });
});
