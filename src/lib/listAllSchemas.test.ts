// ---------------------------------------------------------------------------
// listAllSchemas tests — the drained schema enumeration used by every schema
// consumer. The interesting behaviour is the MULTI-PAGE drain: unwrapping the
// `{ data, nextCursor }` page envelope and echoing that opaque cursor back as
// `startFrom`. A regression in either (unwrapping the wrong field, or inventing
// a cursor from row data) truncates the record-type pickers or earns a 400, so
// both are covered here rather than only at the single-page level the page
// tests exercise.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../api/vectrosApi', () => ({ vectrosApiClient: vi.fn() }));
import { vectrosApiClient } from '../api/vectrosApi';

import { listAllSchemas } from './listAllSchemas';
import { pageOf, pageOfWithCursor, sealedCursor } from '../test/pageOf';

const mockedClient = vi.mocked(vectrosApiClient);

/** Stub the client so `schemas.listSchemas` resolves the given (pre-built) pages in order. */
function stubListSchemas(listSchemas: ReturnType<typeof vi.fn>): void {
  mockedClient.mockReturnValue({ schemas: { listSchemas } } as never);
}

describe('listAllSchemas', () => {
  beforeEach(() => mockedClient.mockReset());

  it('drains across pages, echoing the envelope cursor back as startFrom', async () => {
    // A live `nextCursor` forces a second fetch; the null cursor on page 2
    // terminates the drain. Page SIZE says nothing either way.
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, typeName: `t${i}` }));
    const page2 = [{ id: 's100', typeName: 't100' }];
    const listSchemas = vi
      .fn()
      .mockResolvedValueOnce(pageOfWithCursor(page1, sealedCursor(1)))
      .mockResolvedValueOnce(pageOf(page2));
    stubListSchemas(listSchemas);

    const result = await listAllSchemas('tnt_1', 'default');

    // Both pages concatenated, in order.
    expect(result).toHaveLength(101);
    expect(result[100]?.id).toBe('s100');
    // First page omits startFrom; the second echoes page 1's opaque cursor —
    // NOT a row id, which the API would refuse.
    expect(listSchemas).toHaveBeenNthCalledWith(1, { limit: 100 });
    expect(listSchemas).toHaveBeenNthCalledWith(2, { startFrom: sealedCursor(1), limit: 100 });
    // The client is resolved for the requested (tenant, context).
    expect(mockedClient).toHaveBeenCalledWith('tnt_1', 'default');
  });

  it('keeps draining through an empty page that carries a live cursor', async () => {
    // A scope-filtered page can be empty with schemas still behind it; stopping
    // here would silently drop record types from every picker downstream.
    const listSchemas = vi
      .fn()
      .mockResolvedValueOnce(pageOfWithCursor([{ id: 's1', typeName: 't1' }], sealedCursor(1)))
      .mockResolvedValueOnce(pageOfWithCursor([], sealedCursor(2)))
      .mockResolvedValueOnce(pageOf([{ id: 's2', typeName: 't2' }]));
    stubListSchemas(listSchemas);

    const result = await listAllSchemas('tnt_1', 'default');

    expect(result.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(listSchemas).toHaveBeenCalledTimes(3);
  });

  it('stops after a single terminal page (no second fetch) and defaults the context', async () => {
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
