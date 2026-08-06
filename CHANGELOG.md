# Changelog

All notable changes to app.vectros.ai are documented here.
This project adheres to [Semantic Versioning](https://semver.org).

## 0.12.0 — 2026-08-05

### Changed

- **Repinned to `@vectros-ai/sdk` 0.38.0.**

### Added

- **Support for composite lookups** — a schema lookup declared over more than
  one field at once (e.g. `status` and `area` together). A schema's detail
  page shows a composite's declared identity — its member field names joined
  by comma (e.g. `status,area`), the same spelling the API's `field` query
  parameter uses. Records can be looked up by one: the lookup panel offers a
  composite as one value input per declared field, matching on all of them at
  once. A value is required for every declared field for now — matching on a
  leading subset of them (which the API supports, returning results grouped
  by the fields you left out) isn't exposed yet. Composite lookups are
  record-only, so this doesn't apply to documents.
- **An exact records lookup can now be narrowed to a window of when it
  happened.** Optional "Sort from" / "Sort to" bounds, offered alongside an
  exact (or composite) match, narrow results to a range of the lookup's own
  sort order — by default when the record was created, unless the lookup
  sorts by something else. Either bound may be given alone. Only offered
  where the bound's units are unambiguous (the default creation-time sort, or
  a lookup explicitly sorted by last-updated); a lookup sorted by a custom
  field doesn't show the window, since there'd be no way to say what a
  typed-in value means for it.

## 0.11.2 — 2026-08-04

### Fixed

- **Lists that span more than one page are complete again.** Every list the app drains itself — the
  context switcher's profile listing, the schema enumeration, the folder pickers, and the document
  list — paged by taking the last row's `id` as the next `startFrom`. That is not what `startFrom` means: the API returns an
  opaque `nextCursor` in each page, and `startFrom` is that cursor echoed back. Feeding it a row id
  resumed from the wrong position on any listing whose cursor is more than a plain row key — an
  ownership-scope filter, for one — and is refused outright by newer API versions, which authenticate
  the cursor and answer a fabricated one with a 400. The context switcher is the widest blast radius:
  a principal holding more profiles than fit on one page could fail to load the app at all. The
  paginator now hands the envelope's cursor straight back.

- **A page that comes back short or empty no longer ends a drain.** Server-side filtering is applied
  to each page after that page's cursor is captured, so a filtered listing routinely yields an empty
  page with rows still behind it — normal for any credential carrying a data scope. The drain
  terminated on `data.length < limit` and silently dropped everything past such a page. Only a null
  cursor ends it now, and a listing that is still not exhausted at the page ceiling raises an error
  rather than quietly returning a partial result. A listing of exactly the ceiling's worth of rows
  still drains completely: a full final page carries a live cursor, so confirming exhaustion costs
  one request beyond the last page of data, and that request is not charged against the ceiling.

- **A folder list that fails to load now says so, on Ask, Search, and document detail.** All three
  fell back to an empty list, so a failure was indistinguishable from a context with no folders: the
  scope picker simply did not appear. On Ask that is the worst of the three — you could ask a question
  believing it was scoped to a folder when the scoping control had never loaded. Each surface now
  shows an error explaining what is missing and what the results or answer actually cover.

## 0.11.1 — 2026-08-03

### Fixed

- **The ownership-scope filter now rejects a value the API would reject.** The filter box checked only
  that a value was non-empty and free of whitespace, so entries containing a colon or other
  punctuation were sent and came back as an error from the server. It now applies the same grammar the
  API does — 1-128 characters, a letter or digit first, then letters, digits, `_` and `-` — and flags
  the value inline instead.

## 0.11.0 — 2026-07-27

### Security

- Upgrade `react-router` to `^8.3.0`, clearing five published advisories that
  covered every 6.x/7.x release and 8.x up to 8.2.0. Three of the five are
  specific to server-side rendering and React Server Components, which this app
  does not use; the two that can reach a browser-only app are an open redirect
  via backslashes in link targets and inefficient route matching.

  Note that the upgrade does **not** by itself make a link target safe: an
  attacker-controlled value passed to `<Link to>` or `navigate()` can still
  resolve off-origin. Validate any redirect target you accept from a URL or
  from user input before routing to it — this app builds every navigation
  target from a literal path, so it has no such input today.

### Changed

- **Minimum React and Node versions are now higher**, following the router
  upgrade above. Forks need **React 19.2.7+** (this app pins 19.2.8) and
  **Node 22.22.0+**; `engines.node` was narrowed to `>=22.22.0` to match.

### Added

- **A schema's lineage is now shown.** A record type can have a shared base
  schema plus one or more per-owner customizations of it. The schema browser
  now shows, for each schema, whether it's the shared base or a customization
  of one (with a link to the base); a schema's own detail page shows the same,
  linking through to whichever schema it customizes.
- Route-matching regression tests covering that a static path segment still
  out-ranks a sibling dynamic one — `/records/new` opens the create editor
  rather than a record whose id is the literal string "new" — and that a record
  or document id survives being encoded into a link and read back out,
  including ids containing `+`, `@`, `:`, `/`, `?`, `#` and `%`.

### Fixed

- **Record views now resolve the right schema when a type has more than one.**
  The records list, the record detail view, and the "new record" type picker
  previously matched a record type by name against the full schema list —
  correct only while every type name mapped to exactly one schema. Now that a
  type can have a shared base plus per-owner customizations sharing its name,
  that match could silently pick an unrelated schema and show the wrong
  fields. Each of these now resolves the caller's own schema for a type the
  same way creating a record already did, and a type with more than one
  schema no longer shows indistinguishable duplicate entries in its picker.
- **The documents list could hide documents of a type with more than one
  schema.** Switching to a type whose name has both a shared base schema and a
  customization of it filtered documents by matching a single resolved schema
  — so every document filed under the type's OTHER schema silently
  disappeared from the typed view instead of just showing the wrong columns.
  The list now scopes by the type name itself, so every document of the
  selected type stays visible regardless of which specific schema governs it;
  the "add document" type picker and its documented default no longer show
  duplicate entries for the same type name either.
- **The documents type filter could briefly show "All types"** right after
  picking a specific type, and could stay stuck that way if the type's schema
  failed to load — even though the list underneath was already correctly
  filtered. The filter now always reflects the type you picked.
- **Search's type filter could show a duplicate, unselectable entry** for a
  type with more than one schema (a shared base plus your own customization
  of it), the same issue already fixed on the records and documents pages.

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
