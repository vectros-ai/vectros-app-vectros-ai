// ---------------------------------------------------------------------------
// Document-type helpers — the pure logic behind the documents-by-type view.
//
// A document's type is indirect: the document carries a `schemaId`, and the
// schema carries the `typeName` (and declares, via `allowedSurfaces`, whether
// it binds to documents at all). These helpers resolve that hop so the
// documents list can filter/group by type and label rows with the type name,
// mirroring how the records explorer treats `typeName` as first-class.
//
// Also home to the Markdown-detection heuristic for the in-app viewer: the
// platform stores document text verbatim and returns it as JSON, so what a
// body "is" is never declared — text-ingested documents have no fileType, and
// browsers often report no MIME type for uploaded .md files. Detection is
// therefore best-effort (MIME when present, else the title's extension), and
// the viewer keeps a manual rendered/raw toggle as the escape hatch.
//
// Kept framework-free so all of it is unit-testable in isolation.
// ---------------------------------------------------------------------------

import type { SchemaResponse, Vectros } from '../api/vectrosApi';
import type { RenderHints } from './recordForm';
import { schemasForSurface } from './schemaSurfaces';
import type { TypedSchema } from './schemaSurfaces';

type FieldDef = Vectros.FieldDef;

/** A schema usable as a document type (a typeName that binds to documents). */
export type DocumentTypeSchema = TypedSchema;

/**
 * The schemas that define document types: those with a `typeName` whose
 * `allowedSurfaces` includes `document`. These are the selectable types for
 * the by-type document view. Declared order is preserved.
 * (The records explorer applies the same filter for the `record` surface —
 * see lib/schemaSurfaces.ts.)
 */
export function documentSurfaceSchemas(
  schemas: ReadonlyArray<SchemaResponse>,
): DocumentTypeSchema[] {
  return schemasForSurface(schemas, 'document');
}

/**
 * schemaId → typeName for every schema that declares one. Resolves a
 * document's type for the listing's Type column (a document references its
 * schema by id only). Deliberately spans ALL typed schemas, not just
 * document-surface ones, so a document bound to a legacy or misdeclared
 * schema still shows its type rather than a dash.
 */
export function typeNameBySchemaId(
  schemas: ReadonlyArray<SchemaResponse>,
): Map<string, string> {
  const byId = new Map<string, string>();
  for (const s of schemas) {
    if (s.id && typeof s.typeName === 'string') byId.set(s.id, s.typeName);
  }
  return byId;
}

/**
 * ALL schema fields ordered for display: `renderHints.order` ascending (missing
 * order sorts last), stable for ties. Unlike `orderedFormFields` this does NOT
 * filter to the form-editable types — the read-only metadata panel shows array
 * (tags), object, and reference fields too, which have no typed form input.
 */
export function orderedPayloadFields(
  fields: ReadonlyArray<FieldDef>,
  hints?: RenderHints,
): FieldDef[] {
  return fields
    .map((field, index) => ({ field, index, order: hints?.[field.fieldId]?.order }))
    .sort((a, b) => {
      const ao = a.order ?? Number.POSITIVE_INFINITY;
      const bo = b.order ?? Number.POSITIVE_INFINITY;
      return ao !== bo ? ao - bo : a.index - b.index;
    })
    .map((entry) => entry.field);
}

/** MIME types that declare Markdown outright. */
const MARKDOWN_MIME_TYPES = new Set(['text/markdown', 'text/x-markdown']);

/** Title/filename extensions that indicate Markdown. */
const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];

/**
 * Whether a document's text body is likely Markdown — drives the viewer's
 * DEFAULT view only (rendered vs raw); the user can always toggle. True when
 * the fileType is a Markdown MIME type, or the title ends in a Markdown
 * extension (ingested docs are commonly titled with their source filename).
 */
export function isLikelyMarkdown(title?: string, fileType?: string): boolean {
  if (fileType !== undefined && MARKDOWN_MIME_TYPES.has(fileType.toLowerCase())) return true;
  if (title === undefined) return false;
  const t = title.trim().toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => t.endsWith(ext));
}

/**
 * Text bodies above this size default the viewer to the raw view (rendering a
 * very large Markdown tree is slow enough to jank the tab). The toggle still
 * allows rendering on demand — this only picks the safer default.
 */
export const MARKDOWN_RENDER_DEFAULT_MAX_BYTES = 300 * 1024;

/**
 * Cap on fetching a file-backed document's original for INLINE viewing (the
 * click-to-view path for file-mode Markdown docs, which have no stored text).
 * Beyond this, download is the only offer — pulling tens of MB into the tab
 * to render is worse than the download it replaces.
 */
export const FILE_INLINE_VIEW_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Whether a file-backed document qualifies for the click-to-view-in-app path:
 * likely Markdown (see isLikelyMarkdown) and small enough to fetch inline.
 * `fileSize` may be 0 while an upload is still pending — the fetch's error
 * state covers a not-yet-uploaded object.
 */
export function isInlineViewableMarkdownFile(
  title: string | undefined,
  fileType: string | undefined,
  fileSize: number | undefined,
): boolean {
  return isLikelyMarkdown(title, fileType) && (fileSize ?? 0) <= FILE_INLINE_VIEW_MAX_BYTES;
}

/**
 * The text card's DEFAULT view for a document body: rendered for
 * likely-Markdown content small enough to render comfortably, else raw. The
 * user's toggle always overrides — this only picks the starting point.
 * `sizeBytes` is the stored text size (`textBytes` when the API returned it;
 * a UTF-16 length is an acceptable under-estimate fallback).
 */
export function defaultTextView(
  title: string | undefined,
  fileType: string | undefined,
  sizeBytes: number,
): 'rendered' | 'raw' {
  return isLikelyMarkdown(title, fileType) && sizeBytes <= MARKDOWN_RENDER_DEFAULT_MAX_BYTES
    ? 'rendered'
    : 'raw';
}
