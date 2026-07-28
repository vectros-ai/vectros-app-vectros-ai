// ---------------------------------------------------------------------------
// Route-matching regression tests.
//
// The router is a load-bearing dependency whose matching and path-encoding
// rules changed under us, in two ways a page-level suite does not notice:
//
//   * RANKING between a static segment and a sibling dynamic one. /records/new
//     and /records/:recordId compete for the same url. If the dynamic sibling
//     wins, "new record" opens the DETAIL page for a record whose id is the
//     literal string "new" — a real page, mounted without error, so a suite
//     that only asserts "something rendered" stays green.
//   * Path-param ENCODING. The encoder follows RFC 3986 path-segment rules, so
//     the pchar set ($ & + , ; = : @) is now left literal rather than
//     percent-encoded. Record, schema and document ids flow straight into
//     links via encodeURIComponent and come back out through useParams, so an
//     encode/match round-trip is exactly where a silent regression lands.
//
// Both are asserted through a RENDERED router, not through matchPath(): only a
// rendered Routes tree can express "which sibling won", and matchPath() does
// not decode params the way the router does (it returns "a%3Fb" where the
// router hands the page "a?b"), so asserting against it would pin the wrong
// contract.
//
// Patterns are copied from App.tsx — keep them in sync.
// ---------------------------------------------------------------------------

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Navigate, Route, Routes, generatePath, useParams } from 'react-router';

const RECORD_DETAIL = '/records/:recordId';
const RECORD_EDIT = '/records/:recordId/edit';
const SCHEMA_DETAIL = '/schemas/:schemaId';
const DOCUMENT_DETAIL = '/documents/:documentId';

function Marker({ id }: { id: string }) {
  const params = useParams();
  return (
    <div>
      <span data-testid="route">{id}</span>
      <span data-testid="recordId">{params.recordId ?? ''}</span>
      <span data-testid="schemaId">{params.schemaId ?? ''}</span>
      <span data-testid="documentId">{params.documentId ?? ''}</span>
    </div>
  );
}

/**
 * Mirrors App.tsx's data-section patterns and their sibling ORDER — order is
 * the tie-breaker the ranking rules fall back on, so a reordered copy would
 * not be testing the real table.
 */
function DataRoutes() {
  return (
    <Routes>
      <Route path="/records" element={<Marker id="records-list" />} />
      <Route path="/records/new" element={<Marker id="record-new" />} />
      <Route path={RECORD_DETAIL} element={<Marker id="record-detail" />} />
      <Route path={RECORD_EDIT} element={<Marker id="record-edit" />} />
      <Route path="/schemas" element={<Marker id="schemas-list" />} />
      <Route path={SCHEMA_DETAIL} element={<Marker id="schema-detail" />} />
      <Route path="/documents" element={<Marker id="documents-list" />} />
      <Route path={DOCUMENT_DETAIL} element={<Marker id="document-detail" />} />
      <Route path="/ai" element={<Marker id="ai-layout" />}>
        <Route index element={<Navigate to="chat" replace />} />
        <Route path="chat" element={<Marker id="ai-chat" />} />
        <Route path="ask" element={<Marker id="ai-ask" />} />
      </Route>
      <Route path="*" element={<Marker id="not-found" />} />
    </Routes>
  );
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <DataRoutes />
    </MemoryRouter>,
  );
}

const matched = () => screen.getByTestId('route').textContent;

describe('route ranking — static beats dynamic', () => {
  it('sends /records/new to the EDITOR, not to :recordId', () => {
    renderAt('/records/new');
    expect(matched()).toBe('record-new');
  });

  it('sends a real record id to the detail route', () => {
    renderAt('/records/rec-1');
    expect(matched()).toBe('record-detail');
    expect(screen.getByTestId('recordId').textContent).toBe('rec-1');
  });

  it('sends the bare list url to the LIST, not to :recordId', () => {
    renderAt('/records');
    expect(matched()).toBe('records-list');
  });

  it('distinguishes the record detail and edit routes', () => {
    renderAt('/records/rec-1/edit');
    expect(matched()).toBe('record-edit');
    expect(screen.getByTestId('recordId').textContent).toBe('rec-1');
  });

  it('routes a schema id to the schema detail route', () => {
    renderAt('/schemas/schema-1');
    expect(matched()).toBe('schema-detail');
    expect(screen.getByTestId('schemaId').textContent).toBe('schema-1');
  });

  it('routes a document id to the document detail route', () => {
    renderAt('/documents/doc-1');
    expect(matched()).toBe('document-detail');
    expect(screen.getByTestId('documentId').textContent).toBe('doc-1');
  });

  it('falls through to the catch-all for an unknown deep url', () => {
    renderAt('/records/rec-1/edit/extra');
    expect(matched()).toBe('not-found');
  });
});

describe('path-param round-trip', () => {
  // Ids here come from user-authored data, so they are not guaranteed to be
  // slug-shaped. The first group sits in the RFC 3986 pchar set whose encoding
  // changed; the second is the structural characters that must stay escaped so
  // a crafted id cannot break out of its segment into a different route.
  const IDS = [
    'plain-id-123',
    'id:with:colons',
    'id+with+plus',
    'id@with@at',
    'id,with,commas',
    'id=with=equals',
    'id$with&specials',
    'a/b',
    'a?b',
    'a#b',
    'a%b',
    'a b',
    'ä-unicode',
  ];

  it.each(IDS)('record id %j survives generatePath -> router -> useParams', (recordId) => {
    const url = generatePath(RECORD_DETAIL, { recordId });
    renderAt(url);

    // An id that escaped its segment would match a different route entirely.
    expect(matched()).toBe('record-detail');
    // Whether the encoder percent-encoded a character or left it literal is
    // its business; the decoded value the page reads back is the contract.
    expect(screen.getByTestId('recordId').textContent).toBe(recordId);
  });

  it.each(IDS)('document id %j survives the round-trip', (documentId) => {
    const url = generatePath(DOCUMENT_DETAIL, { documentId });
    renderAt(url);

    expect(matched()).toBe('document-detail');
    expect(screen.getByTestId('documentId').textContent).toBe(documentId);
  });

  it('CANNOT round-trip an id that collides with the create sentinel', () => {
    // Known limitation, pinned deliberately. `/records/new` is a real route and
    // out-ranks `/records/:recordId`, so a record whose id is literally "new"
    // is unreachable from its own link — RecordsPage builds
    // `/records/${encodeURIComponent(id)}` from API data, and that URL opens
    // the create editor instead of the record.
    //
    // Asserted so the shadowing is visible and a future change to the sentinel
    // (a `/records/-/new` style prefix, say) shows up here as a failure rather
    // than passing silently.
    const url = generatePath(RECORD_DETAIL, { recordId: 'new' });
    expect(url).toBe('/records/new');

    renderAt(url);
    expect(matched()).toBe('record-new');
    expect(screen.getByTestId('recordId').textContent).toBe('');
  });

  it('round-trips an id through the nested edit route', () => {
    const url = generatePath(RECORD_EDIT, { recordId: 'rec+one@v2' });
    renderAt(url);

    expect(matched()).toBe('record-edit');
    expect(screen.getByTestId('recordId').textContent).toBe('rec+one@v2');
  });
});
