// ---------------------------------------------------------------------------
// App — the route table.
//
// Structure:
//   - Public route (no auth gate, no AppLayout) for the login flow.
//   - A layout-route wrapping RequireAuth + AppLayout for authenticated pages.
//     The Outlet inside AppLayout renders the matched child route.
//   - A catch-all `*` renders a dedicated 404.
//
// BrowserRouter is provided by main.tsx (NOT here). This lets tests render
// <App /> inside a <MemoryRouter> with a controlled initial URL.
//
// app.vectros.ai is the DATA plane: it has no identity/account-management or
// signup/invite flows (those are control-plane concerns owned by the admin
// app). So there is no /accept,
// /confirm, /forgot-password, or /signup here — only sign-in + the data
// surfaces. The /account route is a thin hand-off to the admin app.
// ---------------------------------------------------------------------------

import { Navigate, Route, Routes } from 'react-router';

// Deep-import nav icons (not the barrel) — MUI v7's icons package trips jsdom
// EMFILE on Windows when the barrel is resolved, and deep imports tree-shake
// more reliably.
import HomeIcon from '@mui/icons-material/Home';
import TableRowsIcon from '@mui/icons-material/TableRows';
import SchemaIcon from '@mui/icons-material/Schema';
import DescriptionIcon from '@mui/icons-material/Description';
import SearchIcon from '@mui/icons-material/Search';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';

import { AppLayout, RequireAuth } from '@vectros-ai/react';
import type { NavItemSpec } from '@vectros-ai/react';
import { BRAND } from './brand';
import { ContextSwitcher } from './components/ContextSwitcher';
import { RequireContext } from './components/RequireContext';
import { AccountPage } from './pages/protected/AccountPage';
import { AiWorkspaceLayout } from './pages/protected/AiWorkspaceLayout';
import { AskPage } from './pages/protected/AskPage';
import { ChatPage } from './pages/protected/ChatPage';
import { DocumentDetailPage } from './pages/protected/DocumentDetailPage';
import { DocumentsPage } from './pages/protected/DocumentsPage';
import { HomePage } from './pages/protected/HomePage';
import { RecordDetailPage } from './pages/protected/RecordDetailPage';
import { RecordEditorPage } from './pages/protected/RecordEditorPage';
import { RecordsPage } from './pages/protected/RecordsPage';
import { SchemaDetailPage } from './pages/protected/SchemaDetailPage';
import { SchemasPage } from './pages/protected/SchemasPage';
import { SearchPage } from './pages/protected/SearchPage';
import { LoginPage } from './pages/public/LoginPage';
import { NotFoundPage } from './pages/public/NotFoundPage';

// Sidebar nav. `gateAction: null` = always visible (no scope gate). The
// remaining data-plane surfaces (Documents, Search, AI) join this list as their
// pages land in later phases. Labels are i18n message ids.
const NAV_ITEMS: ReadonlyArray<NavItemSpec> = [
  { to: '/', labelId: 'layout.navHome', gateAction: null, icon: <HomeIcon fontSize="small" /> },
  { to: '/records', labelId: 'layout.navRecords', gateAction: null, icon: <TableRowsIcon fontSize="small" /> },
  { to: '/schemas', labelId: 'layout.navSchemas', gateAction: null, icon: <SchemaIcon fontSize="small" /> },
  { to: '/documents', labelId: 'layout.navDocuments', gateAction: null, icon: <DescriptionIcon fontSize="small" /> },
  { to: '/search', labelId: 'layout.navSearch', gateAction: null, icon: <SearchIcon fontSize="small" /> },
  { to: '/ai', labelId: 'layout.navAi', gateAction: null, icon: <AutoAwesomeIcon fontSize="small" /> },
];

export default function App(): React.JSX.Element {
  return (
    <Routes>
      {/* Public auth route — no RequireAuth, no AppLayout chrome. */}
      <Route path="/login" element={<LoginPage />} />

      {/* Authenticated routes — gated by RequireAuth, wrapped in AppLayout.
          The ContextSwitcher fills the AppBar's switcher slot (data-plane
          analogue of admin-app's TenantSwitcher). */}
      <Route
        element={
          <RequireAuth>
            <AppLayout
              brandName={BRAND.productName}
              brandLogoSrc={BRAND.logo}
              brandQualifier={BRAND.appQualifier}
              navItems={NAV_ITEMS}
              switcher={<ContextSwitcher />}
            />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="/account" element={<AccountPage />} />
        {/* Data-plane routes — gated on an active context (RequireContext) so
            useActiveContextId() is always resolved when these pages mount. */}
        <Route element={<RequireContext />}>
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/records/new" element={<RecordEditorPage />} />
          <Route path="/records/:recordId" element={<RecordDetailPage />} />
          <Route path="/records/:recordId/edit" element={<RecordEditorPage />} />
          <Route path="/schemas" element={<SchemasPage />} />
          <Route path="/schemas/:schemaId" element={<SchemaDetailPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/documents/:documentId" element={<DocumentDetailPage />} />
          <Route path="/search" element={<SearchPage />} />
          {/* AI workspace — a section with sub-tabs (chat now; ask in a later slice). */}
          <Route path="/ai" element={<AiWorkspaceLayout />}>
            <Route index element={<Navigate to="chat" replace />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="ask" element={<AskPage />} />
          </Route>
        </Route>
      </Route>

      {/* Unknown route → dedicated 404. Chrome-less; its "back home" link
          funnels through RequireAuth for unauth users. */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
