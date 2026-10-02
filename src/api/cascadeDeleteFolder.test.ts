// ---------------------------------------------------------------------------
// cascadeDeleteFolder tests — planning (depth-first, innermost-first) and
// execution (progress, 404-as-done, resume-on-retry).
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import {
  CascadeDeletePartialError,
  planFolderCascadeDelete,
  runCascadeDelete,
  type CascadeStep,
} from './cascadeDeleteFolder';
import { pageOf } from '../test/pageOf';
import type { VectrosClient } from './vectrosApi';

/** A minimal mock client — only the sub-clients/methods this module calls. */
function mockClient(opts: {
  foldersByParent?: Record<string, ReadonlyArray<{ id: string; name?: string }>>;
  documentsByFolder?: Record<string, ReadonlyArray<{ id: string; title?: string }>>;
  recordsByFolder?: Record<string, ReadonlyArray<{ id: string; externalId?: string }>>;
  deleteDocument?: (req: { id: string }) => Promise<void>;
  deleteRecord?: (req: { id: string }) => Promise<void>;
  deleteFolder?: (req: { id: string }) => Promise<void>;
}): VectrosClient {
  return {
    folders: {
      listFolders: vi.fn((req: { parentFolderId?: string }) =>
        Promise.resolve(pageOf(opts.foldersByParent?.[req.parentFolderId ?? ''] ?? [])),
      ),
      deleteFolder: opts.deleteFolder ?? vi.fn().mockResolvedValue(undefined),
    },
    documents: {
      listDocuments: vi.fn((req: { folderId?: string }) =>
        Promise.resolve(pageOf(opts.documentsByFolder?.[req.folderId ?? ''] ?? [])),
      ),
      deleteDocument: opts.deleteDocument ?? vi.fn().mockResolvedValue(undefined),
    },
    records: {
      listRecords: vi.fn((req: { folderId?: string }) =>
        Promise.resolve(pageOf(opts.recordsByFolder?.[req.folderId ?? ''] ?? [])),
      ),
      deleteRecord: opts.deleteRecord ?? vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as VectrosClient;
}

describe('planFolderCascadeDelete', () => {
  it('plans an already-empty folder as just itself', async () => {
    const client = mockClient({});
    const plan = await planFolderCascadeDelete(client, 'f1', 'Reports');
    expect(plan.steps).toEqual([{ kind: 'folder', id: 'f1', label: 'Reports' }]);
    expect(plan).toMatchObject({ documentCount: 0, recordCount: 0, subFolderCount: 0 });
  });

  it('orders a single folder’s own documents, then records, then itself', async () => {
    const client = mockClient({
      documentsByFolder: { f1: [{ id: 'd1', title: 'Doc' }] },
      recordsByFolder: { f1: [{ id: 'r1', externalId: 'rec_1' }] },
    });
    const plan = await planFolderCascadeDelete(client, 'f1', 'Reports');
    expect(plan.steps).toEqual([
      { kind: 'document', id: 'd1', label: 'Doc' },
      { kind: 'record', id: 'r1', label: 'rec_1' },
      { kind: 'folder', id: 'f1', label: 'Reports' },
    ]);
    expect(plan).toMatchObject({ documentCount: 1, recordCount: 1, subFolderCount: 0 });
  });

  it('recurses depth-first, deleting the innermost sub-folder’s contents and itself before its parent’s', async () => {
    // f1 (root) > f2 (sub) > f3 (sub-sub), each holding one document.
    const client = mockClient({
      foldersByParent: {
        f1: [{ id: 'f2', name: 'Sub' }],
        f2: [{ id: 'f3', name: 'SubSub' }],
      },
      documentsByFolder: {
        f1: [{ id: 'd1', title: 'Root doc' }],
        f2: [{ id: 'd2', title: 'Sub doc' }],
        f3: [{ id: 'd3', title: 'SubSub doc' }],
      },
    });
    const plan = await planFolderCascadeDelete(client, 'f1', 'Root');
    expect(plan.steps.map((s) => `${s.kind}:${s.id}`)).toEqual([
      'document:d3',
      'folder:f3',
      'document:d2',
      'folder:f2',
      'document:d1',
      'folder:f1',
    ]);
    expect(plan.subFolderCount).toBe(2);
    expect(plan.documentCount).toBe(3);
  });

  it('skips a listed row with no id rather than staging an undeletable step', async () => {
    const client = mockClient({
      documentsByFolder: {
        f1: [
          { id: '', title: 'No id' },
          { id: 'd1', title: 'Real' },
        ],
      },
    });
    const plan = await planFolderCascadeDelete(client, 'f1', 'Reports');
    expect(plan.steps.filter((s) => s.kind === 'document')).toEqual([
      { kind: 'document', id: 'd1', label: 'Real' },
    ]);
    expect(plan.documentCount).toBe(1);
  });
});

describe('runCascadeDelete', () => {
  const steps: CascadeStep[] = [
    { kind: 'document', id: 'd1', label: 'Doc 1' },
    { kind: 'record', id: 'r1', label: 'rec_1' },
    { kind: 'folder', id: 'f1', label: 'Reports' },
  ];

  it('deletes every step in order and reports progress after each one', async () => {
    const deleteDocument = vi.fn().mockResolvedValue(undefined);
    const deleteRecord = vi.fn().mockResolvedValue(undefined);
    const deleteFolder = vi.fn().mockResolvedValue(undefined);
    const client = mockClient({ deleteDocument, deleteRecord, deleteFolder });
    const progress: Array<{ completed: number; total: number }> = [];

    await runCascadeDelete(client, steps, 0, (p) => progress.push(p));

    expect(deleteDocument).toHaveBeenCalledWith({ id: 'd1' });
    expect(deleteRecord).toHaveBeenCalledWith({ id: 'r1' });
    expect(deleteFolder).toHaveBeenCalledWith({ id: 'f1' });
    expect(progress).toEqual([
      { completed: 1, total: 3 },
      { completed: 2, total: 3 },
      { completed: 3, total: 3 },
    ]);
  });

  it('stops and throws a partial error naming how far it got, without touching later steps', async () => {
    const deleteRecord = vi
      .fn()
      .mockRejectedValue({ statusCode: 409, body: { message: 'conflict' } });
    const deleteFolder = vi.fn();
    const client = mockClient({ deleteRecord, deleteFolder });

    const err = await runCascadeDelete(client, steps, 0, () => {}).catch((e) => e as unknown);

    expect(err).toBeInstanceOf(CascadeDeletePartialError);
    const partial = err as CascadeDeletePartialError;
    expect(partial.completed).toBe(1); // the document delete succeeded first
    expect(partial.total).toBe(3);
    expect(partial.failedStep).toEqual(steps[1]);
    expect(deleteFolder).not.toHaveBeenCalled();
  });

  it('treats a 404 on a step as already-done rather than a failure', async () => {
    const deleteRecord = vi.fn().mockRejectedValue({ statusCode: 404 });
    const deleteFolder = vi.fn().mockResolvedValue(undefined);
    const client = mockClient({ deleteRecord, deleteFolder });
    const progress: Array<{ completed: number; total: number }> = [];

    await runCascadeDelete(client, steps, 0, (p) => progress.push(p));

    expect(deleteFolder).toHaveBeenCalledWith({ id: 'f1' }); // continued past the 404
    expect(progress).toHaveLength(3);
  });

  it('resumes from startIndex, re-issuing no delete for already-completed steps', async () => {
    const deleteDocument = vi.fn().mockResolvedValue(undefined);
    const deleteRecord = vi.fn().mockResolvedValue(undefined);
    const deleteFolder = vi.fn().mockResolvedValue(undefined);
    const client = mockClient({ deleteDocument, deleteRecord, deleteFolder });

    await runCascadeDelete(client, steps, 1, () => {}); // resume as if step 0 already succeeded

    expect(deleteDocument).not.toHaveBeenCalled();
    expect(deleteRecord).toHaveBeenCalledWith({ id: 'r1' });
    expect(deleteFolder).toHaveBeenCalledWith({ id: 'f1' });
  });
});
