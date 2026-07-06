// ---------------------------------------------------------------------------
// listAllSchemas tests — the drained schema enumeration used by every schema
// consumer. The interesting behaviour is the MULTI-PAGE drain: unwrapping the
// `{ data, nextCursor }` page envelope and advancing the `startFrom` cursor
// from the last schema's id. A regression in either (unwrapping the wrong
// field, or the wrong cursor key) would silently truncate the record-type
// pickers, so both are covered here rather than only at the single-page level
// the page tests exercise.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../api/vectrosApi', () => ({ vectrosApiClient: vi.fn() }));
import { vectrosApiClient } from '../api/vectrosApi';

import { listAllSchemas } from './listAllSchemas';
import { pageOf } from '../test/pageOf';

const mockedClient = vi.mocked(vectrosApiClient);

/** Stub the client so `schemas.listSchemas` resolves the given (pre-built) pages in order. */
function stubListSchemas(listSchemas: ReturnType<typeof vi.fn>): void {
  mockedClient.mockReturnValue({ schemas: { listSchemas } } as never);
}

describe('listAllSchemas', () => {
  beforeEach(() => mockedClient.mockReset());

  it('drains across pages, unwrapping the envelope and seeding startFrom from the last id', async () => {
    // A full first page (= SCHEMA_PAGE_SIZE, 100) forces a second fetch; the
    // short second page (< 100) terminates the drain.
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, typeName: `t${i}` }));
    const page2 = [{ id: 's100', typeName: 't100' }];
    const listSchemas = vi
      .fn()
      .mockResolvedValueOnce(pageOf(page1))
      .mockResolvedValueOnce(pageOf(page2));
    stubListSchemas(listSchemas);

    const result = await listAllSchemas('tnt_1', 'default');

    // Both pages concatenated, in order.
    expect(result).toHaveLength(101);
    expect(result[100]?.id).toBe('s100');
    // First page omits startFrom; the second is seeded from page 1's last id.
    expect(listSchemas).toHaveBeenNthCalledWith(1, { limit: 100 });
    expect(listSchemas).toHaveBeenNthCalledWith(2, { startFrom: 's99', limit: 100 });
    // The client is resolved for the requested (tenant, context).
    expect(mockedClient).toHaveBeenCalledWith('tnt_1', 'default');
  });

  it('stops after a single short page (no second fetch) and defaults the context', async () => {
    const listSchemas = vi.fn().mockResolvedValue(pageOf([{ id: 's1', typeName: 't1' }]));
    stubListSchemas(listSchemas);

    const result = await listAllSchemas('tnt_1');

    expect(result.map((s) => s.id)).toEqual(['s1']);
    expect(listSchemas).toHaveBeenCalledTimes(1);
    // Omitting contextId targets the tenant-default context.
    expect(mockedClient).toHaveBeenCalledWith('tnt_1', undefined);
  });

  it('tolerates a page with no data array (empty result)', async () => {
    const listSchemas = vi.fn().mockResolvedValue({ nextCursor: null });
    stubListSchemas(listSchemas);

    await expect(listAllSchemas('tnt_1')).resolves.toEqual([]);
  });
});
