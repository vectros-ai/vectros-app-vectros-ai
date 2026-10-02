// ---------------------------------------------------------------------------
// cascadeDeleteFolder — client-orchestrated recursive folder delete.
//
// The API refuses to delete a folder until every document, record, and
// sub-folder it holds is verified gone — so a cascade that fails partway
// through leaves the folder incompletely emptied, never orphaned and never
// double-deleted. That server-side guard is what makes a plain, sequential
// delete loop safe here, with no transaction of its own required.
//
// `planFolderCascadeDelete` walks the target folder's subtree depth-first,
// innermost folder first: every folder's own documents + records are deleted
// before that folder, and every folder is deleted before its parent's own
// contents/delete. The resulting plan can be executed top-to-bottom in one
// pass with no reordering. `runCascadeDelete` then executes it sequentially,
// reporting progress after each step, and can resume from any index — a step
// whose target 404s (already gone: a retried step, or something else already
// removed it) counts as done rather than failing the whole retry.
// ---------------------------------------------------------------------------

import type { VectrosClient } from './vectrosApi';
import { drainPages } from '../lib/drainPages';

/** Page size for the drained list endpoints — the API's max (default is 20). */
const PAGE_SIZE = 100;

export interface CascadeStep {
  readonly kind: 'document' | 'record' | 'folder';
  readonly id: string;
  /** For progress display only — never used to key anything. */
  readonly label: string;
}

export interface CascadePlan {
  /** Depth-first, innermost-first; the target folder itself is always the last step. */
  readonly steps: readonly CascadeStep[];
  readonly documentCount: number;
  readonly recordCount: number;
  /** Sub-folders only — never counts the target folder itself. */
  readonly subFolderCount: number;
}

export interface CascadeProgress {
  readonly completed: number;
  readonly total: number;
}

/** A 404 on a delete means "already gone" (a retried step, or a row something
 *  else removed) — the only status this module treats as success-not-failure. */
function isAlreadyGone(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    (err as { statusCode?: unknown }).statusCode === 404
  );
}

/**
 * Thrown by `runCascadeDelete` when a step fails for a reason other than
 * "already gone". Carries how far the cascade got (`completed`) so the
 * caller can resume from there on retry rather than restarting from zero.
 */
export class CascadeDeletePartialError extends Error {
  readonly completed: number;
  readonly total: number;
  readonly failedStep: CascadeStep;
  override readonly cause: unknown;

  constructor(completed: number, total: number, failedStep: CascadeStep, cause: unknown) {
    super(
      `cascade delete failed after ${completed} of ${total} item(s), on ${failedStep.kind} "${failedStep.label}"`,
    );
    this.name = 'CascadeDeletePartialError';
    this.completed = completed;
    this.total = total;
    this.failedStep = failedStep;
    this.cause = cause;
  }
}

/**
 * Walk `rootFolderId`'s subtree and return an execution plan covering every
 * document, record, and sub-folder inside it (recursively), depth-first,
 * innermost first, ending with `rootFolderId` itself as the last step.
 *
 * Only sees what this credential can read: the server's own non-empty check
 * can see a row this credential cannot list. `runCascadeDelete`'s terminal
 * folder-delete step surfaces that gap directly rather than masking it — if
 * it still fails after every planned item is gone, something outside this
 * credential's visibility is still filed there.
 */
export async function planFolderCascadeDelete(
  client: VectrosClient,
  rootFolderId: string,
  rootFolderLabel: string,
): Promise<CascadePlan> {
  const steps: CascadeStep[] = [];
  let documentCount = 0;
  let recordCount = 0;
  let subFolderCount = 0;

  async function visit(folderId: string, folderLabel: string): Promise<void> {
    const subFolders = await drainPages((startFrom) =>
      client.folders.listFolders(
        startFrom === undefined
          ? { parentFolderId: folderId, limit: PAGE_SIZE }
          : { parentFolderId: folderId, startFrom, limit: PAGE_SIZE },
      ),
    );
    for (const sub of subFolders) {
      if (!sub.id) continue;
      subFolderCount += 1;
      await visit(sub.id, sub.name && sub.name.length > 0 ? sub.name : sub.id);
    }

    const documents = await drainPages((startFrom) =>
      client.documents.listDocuments(
        startFrom === undefined
          ? { folderId, limit: PAGE_SIZE }
          : { folderId, startFrom, limit: PAGE_SIZE },
      ),
    );
    for (const d of documents) {
      if (!d.id) continue;
      documentCount += 1;
      steps.push({
        kind: 'document',
        id: d.id,
        label: d.title && d.title.length > 0 ? d.title : d.id,
      });
    }

    const records = await drainPages((startFrom) =>
      client.records.listRecords(
        startFrom === undefined
          ? { folderId, limit: PAGE_SIZE }
          : { folderId, startFrom, limit: PAGE_SIZE },
      ),
    );
    for (const r of records) {
      if (!r.id) continue;
      recordCount += 1;
      steps.push({
        kind: 'record',
        id: r.id,
        label: r.externalId && r.externalId.length > 0 ? r.externalId : r.id,
      });
    }

    steps.push({ kind: 'folder', id: folderId, label: folderLabel });
  }

  await visit(rootFolderId, rootFolderLabel);
  return { steps, documentCount, recordCount, subFolderCount };
}

async function deleteOneStep(client: VectrosClient, step: CascadeStep): Promise<void> {
  if (step.kind === 'document') await client.documents.deleteDocument({ id: step.id });
  else if (step.kind === 'record') await client.records.deleteRecord({ id: step.id });
  else await client.folders.deleteFolder({ id: step.id });
}

/**
 * Execute `steps[startIndex..]` in order, reporting progress after each one.
 * Stops and throws `CascadeDeletePartialError` on the first step that fails
 * for a reason other than "already gone" — the caller retries by calling this
 * again with `startIndex` set to the thrown error's `completed`.
 */
export async function runCascadeDelete(
  client: VectrosClient,
  steps: readonly CascadeStep[],
  startIndex: number,
  onProgress: (progress: CascadeProgress) => void,
): Promise<void> {
  for (const [i, step] of steps.entries()) {
    if (i < startIndex) continue;
    try {
      await deleteOneStep(client, step);
    } catch (err) {
      if (!isAlreadyGone(err)) {
        throw new CascadeDeletePartialError(i, steps.length, step, err);
      }
    }
    onProgress({ completed: i + 1, total: steps.length });
  }
}
