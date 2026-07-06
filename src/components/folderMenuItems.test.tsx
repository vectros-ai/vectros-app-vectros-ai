// ---------------------------------------------------------------------------
// folderMenuItems tests — the shared folder-picker option builder: tree order,
// the name→id fallback label, and one option per folder.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MenuList } from '@mui/material';

import { folderMenuItems } from './folderMenuItems';
import type { FolderResponse } from '../api/vectrosApi';

function renderItems(folders: ReadonlyArray<FolderResponse>): void {
  // MenuItems render as options inside a MenuList (role="menu").
  render(<MenuList>{folderMenuItems(folders)}</MenuList>);
}

describe('folderMenuItems', () => {
  it('renders one option per folder, labeled by name', () => {
    renderItems([
      { id: 'a', name: 'Alpha' } as FolderResponse,
      { id: 'b', name: 'Beta' } as FolderResponse,
    ]);
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Beta' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('falls back to the id when a folder has no name', () => {
    renderItems([{ id: 'no-name-folder' } as FolderResponse]);
    expect(screen.getByRole('menuitem', { name: 'no-name-folder' })).toBeInTheDocument();
  });

  it('renders nothing for an empty folder list', () => {
    renderItems([]);
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });
});
