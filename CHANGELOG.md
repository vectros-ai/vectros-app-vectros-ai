# Changelog

All notable changes to app.vectros.ai are documented here.
This project adheres to [Semantic Versioning](https://semver.org).

## 0.19.2 — 2026-09-22

### Security

- **A document's "Download original" link is opened only when it is an https URL.** The app asks the API
  for a short-lived download link and opens the result in a new tab. It now opens the link only when it
  is an https URL. A link that is present but not https is refused with its own message ("not a secure
  (https) address", with no "try again", because trying again cannot change it); no link at all still
  shows "couldn't generate a download link".
- **The addresses the app sends a file to, or reads one from, are used only when they are https URLs.**
  Adding a document, replacing a document's file and the in-page file view each use an address the API
  returns (a presigned storage URL). The upload or read now goes ahead only for an https address, and
  the address used is the one that was checked; anything else stops the action and shows its usual error.

### Changed

- **Repinned to `@vectros-ai/sdk` 0.45.0.** No client-side behavior change from the pin bump alone: this app is a
  data-plane explorer with no identity/control-plane call site, so it consumes nothing of 0.45.0's issuer-verification
  surface.

## 0.19.1 — 2026-09-17

### Fixed

- **Removed a stale, unused reference to org/client as "built-in" namespaces.** org and client are
  ordinary registrations (not built-ins); the constant this app never actually consumed, and the
  comments describing it that way, are gone. No behavioral change — this app has no namespace
  registry client and never gated on the constant.
- **Uploading or replacing a document's file now works against an API that makes presigned upload
  URLs single-use.**
  Such an API bakes a conditional-write header into the upload URL's signature and names it in the
  upload response (`requiredHeaderName` / `requiredHeaderValue`); a PUT without that header is
  rejected by storage with a 403. The app now sends whatever header the response names, and no
  extra header when the response names none, so it works against API versions on either side of
  the change.
- **File upload and file replace were completely broken when this app is deployed behind
  CloudFront.** The browser's own Content-Security-Policy blocked the upload PUT outright, before
  it ever reached the network, because the deployed policy's `connect-src` allowed only the host
  used to fetch a document back down, not the (different) host the upload PUT targets. Every
  upload and replace failed with a generic "please check your input and try again," regardless of
  file, network, or account. The policy now allows the upload's host too, alongside the existing
  download one.
- **Running a search again with an unchanged query now re-runs it.** Search served the previous
  result from cache and sent no request, so an item indexed a few seconds after the first search
  stayed missing however often the search was repeated. It now searches again, starting from the
  first page, so a search with several pages loaded is not re-issued once per loaded page. Search
  also gains a "Refresh results" button on its results, empty, and error states, which does the
  same. Going back to an earlier search, or the network reconnecting, no longer re-issues every
  page that search had loaded either: going back runs its first page once, and a reconnect runs
  nothing.
- **Typing an owner scope on Search no longer runs a search per keystroke.** After a search had
  run, each keystroke that formed a valid entry (`org:a`, `org:ac`, and so on) started another
  search, and every search is billed. The owner scope is now applied once it stops changing, or at
  once when you press Search, and a value that means the same as the one already applied runs
  nothing.
- **Pressing "Look up" again with an unchanged lookup now re-runs it** on the Records and Documents
  explorers, instead of serving the cached result. Their Refresh buttons already re-ran the lookup;
  only "Look up" did not.
- **Four source comments and the README's project-layout diagram carried repo-relative internal
  paths** (a sibling reference app's monorepo-relative path in four places, and the README's tree
  root labeled with this app's own monorepo-relative path) that resolve to nothing in this app's
  own public mirror — the mirrored tree root IS the app, so a path prefixed with the monorepo
  location is a broken link there even before considering it as an internal reference. Reworded
  all to state the same guidance without the monorepo-relative prefix; no behavioral change.

- **One more internal path, found on a later sweep**: `.env.example`'s comment on the shared
  Cognito pool named a sibling internal tool by monorepo-relative path — that tool isn't
  source-mirrored at all, so the path is a broken/leaking reference either way.
  Reworded to name it descriptively. No behavioral change.

- **A second, separate leak in the same file, found by a post-merge audit**: `.env.example`'s
  setup instructions named this app's own build/deploy config by monorepo-relative path (a CFN
  template and a CI deploy-pipeline file), neither of which is source-mirrored — the paths were
  dangling in the public repo regardless. Reworded to describe the mechanism without the paths,
  matching the wording already used for the equivalent instructions in the admin reference app's
  own `.env.example`. No behavioral change.

### Changed

- **Repinned to `@vectros-ai/sdk` 0.44.0.** No API surface this app uses changed shape beyond the
  presigned-upload fix already noted above.

## 0.19.0 — 2026-09-07

### Added

- **Search and Ask can narrow by more than one ownership dimension at once.** The
  owner-scope box on Search and on the AI workspace's Ask tab now takes a
  comma-separated list — `org:acme, client:pilot` narrows to one client within one
  org, rather than forcing a choice between the two. A single dimension is sent as
  before; several are sent as the search/RAG `scopeFilters` array, which the API
  treats as mutually exclusive with the single-dimension `scope` field. Up to 16
  dimensions, each namespace named at most once; a filter that breaks either rule
  is flagged in the box instead of firing a request the API would reject.
- **Document lookups can be narrowed by a sort-key window.** A fully-specified
  exact lookup on the Documents explorer now offers the same `Sort from` / `Sort to`
  bounds the Records explorer already had. The documents lookup endpoint has
  accepted these bounds since the previous API release; this app withheld the
  control on the mistaken premise that it did not, so the feature was unreachable
  from the UI.
- **The schema viewer shows the `inline` field flag.** A field declared `inline`
  stays on the record row when the payload is stored out of line, so it appears in
  list and lookup projections without requesting the payload. Schemas that opt in
  to firing triggers also surface `triggersEnabled` in the capability chips.

### Changed

- **A retrieval score in the AI workspace's citations is now labeled, and shown to
  three decimals.** Retrieval runs in hybrid mode, where the score is a Reciprocal
  Rank Fusion value — small and tightly clustered (about 0.016 for a passage ranked
  top on one retrieval leg, about 0.033 for one ranked top on both) rather than a
  0–1 confidence. Rendered bare to two decimals it read as "2% relevant", which is
  not what it means. Search results are unaffected: the percentage there is the
  semantic similarity, which genuinely is 0–1.
- **A search result's date is labeled "Indexed".** It is when the item entered the
  search index — usually when it was created, but later for anything re-indexed
  onto a new entry. The item's own creation time is on its detail page.
- Bundled `@vectros-ai/sdk` updated to the 0.43.0 line.

### Fixed

- **A failed file upload no longer leaves a document behind with no file in it.**
  Adding a document by file is two steps: the document is created, then the bytes
  are sent. If the second step failed, the first was left standing — a document
  with nothing in it, absent from search and impossible to download, which you then
  had to find and delete by hand from its own page. (It was never permanent: the
  platform expires an upload that never completes after 24 hours. It was just yours
  to look at until then.) The dialog now deletes the document it created when the
  upload fails, and reports the upload error rather than a cleanup one. A document
  matched by an existing **External ID** is never deleted this way — it was there
  before the upload started.
- **Replacing a file no longer leaves a stray document behind in the one case where
  it could.** Replacing normally re-uses the document you are already looking at and
  creates nothing. But if its External ID no longer matches anything — the document
  was deleted elsewhere, or its type changed — the platform creates a new document
  instead, and a failed upload stranded that one. It is now cleaned up on failure,
  and only ever in that case.
- **The AI workspace's "sources were trimmed" notice no longer asserts a cause it
  cannot know.** Two independent things drop a retrieved source: it did not fit the
  model's context window, or it carried no usable text to ground an answer. Only the
  first is a budget problem you can act on; the notice claimed it for both, sending
  you after a remedy that does not exist. It now reports the cause the API gives,
  and falls back to a cause-neutral wording for a value it does not recognize.
- **Folder-delete now says records too.** A folder counts as non-empty if it holds
  documents, **records**, or sub-folders; both messages named only documents and
  sub-folders. Note the pre-delete warning still cannot see records — this page
  lists none — so a folder holding only records shows no warning and is refused by
  the server, which is the authoritative check either way.
- **The sort-key window is no longer offered on a range-enabled lookup field.** Such
  a field is stored as an ordered row rather than in a fast lookup slot, so it has no
  sort key to narrow and the API refuses `sortFrom`/`sortTo` on one outright — the
  control was offered anyway (exact is the default match mode), so every submission
  was a guaranteed error. Range over that field's own value with the From/To bounds
  instead; the sort window narrows an equality lookup by a *second* field. This
  affected the records explorer only; the documents explorer's new window (above)
  is offered under the corrected rule from the start.
- **The owner-scope box now refuses every namespace the API refuses.** It knew four
  reserved words plus `user`; the API forbids ten. `document:acme`, `record:…`,
  `entity:…`, `versions:…` and `lookup:…` validated cleanly and were then rejected
  by the server — the exact outcome this validation exists to prevent.
- Corrected the sort-window hint on the Documents explorer, which stated that the
  documents lookup endpoint has no sort-key bounds. It does.
- Corrected the stack table in the README, which named react-router v7 while the
  app has been on v8.

## 0.18.0 — 2026-08-28

### Changed

- Bundled `@vectros-ai/sdk` refreshed to the current release's staging build.
- **`ApiErrorAlert`/`RequestIdCaption` and the API-error extraction helpers
  (`extractErrorMessage`/`extractRequestId`/`statusCodeOf`/`isVersionConflict`) now come from
  `@vectros-ai/react`**, not a local copy — these were byte-identical (comment-only diffs) across
  this app, `admin-app`, and `casework-spa`, so they've been promoted to the shared package
  (`@vectros-ai/react` 0.10.0), continuing this app's own established pattern of consuming the
  shared inference/schema-UI modules rather than keeping local duplicates. No behavior change;
  every call site now imports from `@vectros-ai/react`, `lib/recordEditor.ts`'s `isVersionConflict`
  re-export now points at the package instead of the deleted local `lib/apiError.ts`, and this
  app's own `error.requestId` message catalog entry was removed in favor of the package's base
  catalog entry.

## 0.17.0 — 2026-08-27

### Changed

- **`ChatPage`/`AskPage`/`DocumentAskDrawer`/`InferenceErrorAlert` now consume `useInferenceStream`/
  `reduceInferenceEvent`/`InferenceStreamState` from `@vectros-ai/react`** instead of this app's own
  local `hooks/useInferenceStream.ts`/`lib/inferenceStream.ts`, which are deleted. Those files were
  promoted (copied) into the shared package's own `inference` module and exported from its barrel,
  but this app was never switched over to consume the shared copy — it kept a near-byte-identical
  local duplicate (only the `Vectros` type import path differed: `../api/vectrosApi` vs
  `@vectros-ai/sdk`, both re-exporting the same SDK type). No behavior change — same reducer, same
  hook, same cancellation/stale-run-guard semantics; verified with the full test suite (450/450
  green) after the switch.

## 0.16.0 — 2026-08-27

### Added

- **Composite lookup: the leading-run PARTIAL tuple is now offered, not just the fully-specified
  case.** A composite lookup (`LookupPanel`, declared over several fields at once) previously required
  a value for every declared leg before Apply enabled. The API also accepts a leading run — a lookup
  over `[status, area]` may match on `status` alone — and returns every match grouped by the field(s)
  left unspecified. The panel now offers this: a leg is disabled until its predecessor has a value
  (so its own state can never express a gap the API wouldn't accept), Apply enables once the first leg
  is filled, and a hint names which field(s) the results will be grouped by. The records explorer shows
  a matching "grouped by: …" note and drops client-side column sorting while a grouped result set is
  displayed — sorting would silently flatten the server's adjacency-expressed grouping back into one
  undifferentiated order. The sort-key window (`sortFrom`/`sortTo`) still requires every leg filled,
  unchanged — narrowing is only continuous within one fully-specified combination.

### Changed

- **Repinned to `@vectros-ai/sdk` 0.41.0.** No API surface this app uses changed shape — same
  no-usage-display, Cognito-only, no-error-branching footprint noted at the 0.40.0 repin below still
  holds, and this app doesn't adopt the new `roleIds` access-profile field or the issuer-update
  endpoint; see the [SDK changelog](https://github.com/vectros-ai/sdk/blob/main/CHANGELOG.md) for the
  full release.

## 0.15.0 — 2026-08-25

### Changed

- **Repinned to `@vectros-ai/react` 0.9.0** and switched the schema-driven record form/list rendering
  stack (`schemaSurfaces`/`recordForm`/`recordColumns`/`RecordFormFields`) to import it from the
  package instead of the app-local copies under `src/lib`/`src/components`, which are removed. No
  behavior change — this app's own tests port unchanged and still pass; the four `recordForm.*`
  message strings move to the package's base English catalog (already merged in via `baseMessagesEn`).
  `RecordEditorPage.tsx`'s dual-mode (typed/raw) + optimistic-concurrency (409) pattern stays app-local
  reference wiring around the shared primitives.

## 0.14.0 — 2026-08-19

### Changed

- **Repinned to `@vectros-ai/react` 0.8.0** — the multi-tenant developer-portal methods
  (`getMemberships`/`getActiveTenant`/`listAppContexts`/etc.) moved out of the package's generic
  `useAuth()` surface into a `tenancyProvider` prop on `CurrentTenantProvider` (see that package's
  CHANGELOG for the full reasoning). `main.tsx` now passes the same Cognito adapter to both
  `<AuthProvider>` and `<CurrentTenantProvider tenancyProvider={...}>`; `CurrentContextProvider` now
  reads `getActivePartnerUserId`/`listAppContexts` from `useCurrentTenant()` instead of `useAuth()`.
  No user-visible behavior change.
- **Repinned to `@vectros-ai/sdk` 0.40.0.** No API surface this app uses changed shape — this app has
  no usage/billing display (the admin reference app has that), doesn't call `/v1/auth/token/exchange`
  (Cognito-only), and has no error-code/message branching touched by this release's changes; see the
  [SDK changelog](https://github.com/vectros-ai/sdk/blob/main/CHANGELOG.md) for the full release.

## 0.13.0 — 2026-08-12

### Changed

- **Repinned to `@vectros-ai/sdk` 0.39.0.**

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
