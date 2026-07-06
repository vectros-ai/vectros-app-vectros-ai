// ---------------------------------------------------------------------------
// orderFoldersAsTree tests — depth-first ordering, indentation depth, orphan
// handling, cycle safety.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { orderFoldersAsTree } from './folderTree';
import type { FolderResponse } from '../api/vectrosApi';

const f = (id: string, name: string, parentFolderId?: string): FolderResponse => ({
  id,
  name,
  ...(parentFolderId === undefined ? {} : { parentFolderId }),
});

describe('orderFoldersAsTree', () => {
  it('orders parents before children with computed depth, siblings by name', () => {
    const tree = orderFoldersAsTree([
      f('c', 'Beta', 'root'),
      f('b', 'Alpha', 'root'),
      f('root', 'Root'),
      f('d', 'Child', 'b'),
    ]);
    expect(tree.map((n) => [n.folder.id, n.depth])).toEqual([
      ['root', 0],
      ['b', 1], // Alpha sorts before Beta
      ['d', 2],
      ['c', 1],
    ]);
  });

  it('appends orphans (parent absent) at depth 0 rather than dropping them', () => {
    const tree = orderFoldersAsTree([f('a', 'A', 'missing-parent')]);
    expect(tree).toEqual([{ folder: f('a', 'A', 'missing-parent'), depth: 0 }]);
  });

  it('is cycle-safe (never loops or duplicates)', () => {
    // a → b → a is a cycle with no root; both are orphans appended once each.
    const tree = orderFoldersAsTree([f('a', 'A', 'b'), f('b', 'B', 'a')]);
    expect(tree.map((n) => n.folder.id).sort()).toEqual(['a', 'b']);
  });
});
