// ---------------------------------------------------------------------------
// folderMenuItems — render an indented folder tree as <Select> options.
//
// The same "order folders into a tree, render one indented MenuItem per node"
// block appeared in every folder picker (the add/edit document dialogs, the
// folder editor's parent picker, the documents-page filter). Centralized here
// for one consistent indentation + fallback-label rule.
//
// Returns an ARRAY of MenuItem elements (not a wrapping component): MUI's Select
// reads each child's `value`, so the options must be direct children — callers
// spread the array alongside any leading "None"/"All" sentinel option.
// ---------------------------------------------------------------------------

import { MenuItem } from '@mui/material';

import type { FolderResponse } from '../api/vectrosApi';
import { orderFoldersAsTree } from '../lib/folderTree';

/**
 * Build `<MenuItem>` options for a folder `<Select>`, depth-indented in tree
 * order. Each option's `value` is the folder id; the label falls back to the id
 * when the folder has no name.
 */
export function folderMenuItems(
  folders: ReadonlyArray<FolderResponse>,
): React.JSX.Element[] {
  return orderFoldersAsTree(folders).map(({ folder: f, depth }) => (
    <MenuItem key={f.id} value={f.id}>
      {'  '.repeat(depth)}
      {f.name && f.name.length > 0 ? f.name : f.id}
    </MenuItem>
  ));
}
