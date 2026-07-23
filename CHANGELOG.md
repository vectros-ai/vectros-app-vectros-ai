# Changelog

All notable changes to app.vectros.ai are documented here.
This project adheres to [Semantic Versioning](https://semver.org).

## 0.10.0 — 2026-07-22

### Added

- **A failed index now explains itself.** When a record or document has an index
  status of Failed, the detail page shows the reason and whether the content is
  still partly findable (several failures leave one search leg serving it); the
  records and documents lists show the reason on hover. A failure with no reason
  attached falls back to a generic "retry, and contact support if it persists."
- **A failed record save shows the server's reason.** Creating or editing a
  record that the API rejects now shows the specific explanation — for example, a
  field whose number falls outside the supported range, with the suggestion to
  send large whole numbers as strings — beneath the generic message, instead of
  dropping it.

### Security

- Pin `fast-xml-parser` to a non-vulnerable version (`^5.10.1`) via an override —
  above a published denial-of-service advisory in a transitive dependency.

## 0.9.1 — 2026-07-20

### Fixed

- Reference fields that point at a **sensitive** lookup field now resolve to a
  link on the record detail page. Previously the lookup behind those links was
  rejected, so the reference stayed unresolved and the value rendered as plain
  text with no way to reach the target record.

## 0.9.0 — 2026-07-18

### Changed

- Updated to `@vectros-ai/sdk` 0.35.0. A record's or document's ownership is now
  carried entirely by its ownership scopes (shown as chips on the detail pages);
  the retired `orgId`/`clientId` fields are gone. The Owner row shows the owning
  user, or a dash when an item is owned only by scopes.

## 0.8.0 — 2026-07-11

### Added

- **Ownership scopes on your data** — when you create a record, folder, or
  ingested document you can now choose its ownership: inherit your credential's
  identity (the default), keep it private to you, or set specific namespaced
  scopes such as `org` or a custom `group` (up to two). Record and document
  detail pages show an item's ownership scopes, and you can filter records,
  documents, search results, and Ask retrieval by owner scope in `namespace:value`
  form (for example `group:eng-team`). Uploaded files inherit your credential's
  identity.

## 0.7.1 — 2026-07-10

### Changed

- **Dependency maintenance** — updated `aws-amplify`, `vite`, `vitest`, and the
  Vectros SDK to their current releases and cleared known advisories in
  transitive dependencies. No functional changes.

## 0.7.0 — 2026-07-08

### Added

- **Update-available banner** — after a new version of the app is deployed, an
  already-open tab now shows a dismissible "a new version is available" prompt
  with a Refresh action, so a long-running session can move to the latest build
  instead of eventually hitting a stale-asset error. The refresh is always
  user-initiated.

## 0.6.2 — 2026-07-05

### Added

- **"Keep the extracted text" control on file uploads.** When adding a document by file, choose
  whether to retain the text extracted from it. On by default: the text stays retrievable and
  answerable by AI Q&A. Off: it's discarded once indexing finishes — search and the original-file
  download keep working, but the text can't be read back or asked about. The choice is fixed at
  upload. (Text ingest always keeps its body, so the control appears only in file-upload mode.)

## 0.6.1 — 2026-07-05

### Changed

- Removed the "Keep the raw text retrievable" switch from the text-ingest dialog: text-ingested
  documents always retain their body now, so the toggle no longer did anything. A retention
  control for file uploads (where the choice is real) arrives with the next SDK update.

## 0.6.0 — 2026-07-03

Initial open-source release (starting at 0.6.0 to reflect the internal iteration history) of app.vectros.ai — the data-plane reference
application for the Vectros platform, and a forkable example of building a
data app on the Vectros API.

### Added

- Records explorer: browse by type with schema-driven columns, client-side
  sort and filtering, server-side lookups (exact, range, and prefix on the
  schema's lookup fields), and a dual-mode create/edit editor with
  optimistic-concurrency conflict handling.
- Documents: browse by type and folder, server-side lookups (by external ID
  or any schema lookup field), typed metadata, an in-app Markdown viewer
  with click-to-view for file-backed documents, signed downloads, and
  document create via file upload or text ingest (with optional external
  IDs and update-if-exists semantics).
- Document and record curation: archive (soft-retract from search and AI
  recall, fully recoverable) and restore, plus replace-a-document's-file
  with automatic re-extraction and re-indexing.
- Folders: create, rename, and delete, with folder-scoped listing and
  "ask this folder" deep links into the AI workspace.
- Hybrid search: one ranked result set across records and documents, with
  ranking-mode, content-source, folder, and type filters.
- AI workspace: multi-turn chat over your data, single-shot ask with
  citations, and per-document Q&A, with a model picker.
- Audit-trail version history on records and documents, a context switcher,
  and a single-file re-brand surface (`src/brand.ts`).
