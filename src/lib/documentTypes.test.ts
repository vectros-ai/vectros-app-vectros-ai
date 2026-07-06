// ---------------------------------------------------------------------------
// documentTypes tests — the pure logic behind the documents-by-type view and
// the viewer's Markdown-detection default.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import type { SchemaResponse, Vectros } from '../api/vectrosApi';
import {
  defaultTextView,
  documentSurfaceSchemas,
  FILE_INLINE_VIEW_MAX_BYTES,
  isInlineViewableMarkdownFile,
  isLikelyMarkdown,
  MARKDOWN_RENDER_DEFAULT_MAX_BYTES,
  orderedPayloadFields,
  typeNameBySchemaId,
} from './documentTypes';

type FieldDef = Vectros.FieldDef;

const field = (fieldId: string, fieldType: FieldDef['fieldType'] = 'string'): FieldDef =>
  ({ fieldId, fieldType }) as FieldDef;

describe('documentSurfaceSchemas', () => {
  const schema = (over: Partial<SchemaResponse>): SchemaResponse => over as SchemaResponse;

  it('keeps only typed schemas whose allowedSurfaces includes document', () => {
    const docType = schema({ id: 's1', typeName: 'decision', allowedSurfaces: ['record', 'document'] });
    const recordOnly = schema({ id: 's2', typeName: 'invoice', allowedSurfaces: ['record'] });
    const untyped = schema({ id: 's3', allowedSurfaces: ['document'] });
    const noSurfaces = schema({ id: 's4', typeName: 'note' });

    expect(documentSurfaceSchemas([docType, recordOnly, untyped, noSurfaces])).toEqual([docType]);
  });

  it('preserves declared order', () => {
    const a = schema({ id: 'a', typeName: 'runbook', allowedSurfaces: ['document'] });
    const b = schema({ id: 'b', typeName: 'decision', allowedSurfaces: ['document'] });
    expect(documentSurfaceSchemas([a, b]).map((s) => s.typeName)).toEqual(['runbook', 'decision']);
  });
});

describe('typeNameBySchemaId', () => {
  it('maps every typed schema by id, skipping untyped or id-less entries', () => {
    const schemas = [
      { id: 's1', typeName: 'decision' },
      { id: 's2' }, // no typeName
      { typeName: 'orphan' }, // no id
    ] as SchemaResponse[];

    const map = typeNameBySchemaId(schemas);
    expect(map.get('s1')).toBe('decision');
    expect(map.size).toBe(1);
  });
});

describe('orderedPayloadFields', () => {
  it('orders by renderHints.order (missing last), stable for ties', () => {
    const fields = [field('c'), field('a'), field('b')];
    const hints = { a: { order: 1 }, b: { order: 2 } };
    expect(orderedPayloadFields(fields, hints).map((f) => f.fieldId)).toEqual(['a', 'b', 'c']);
  });

  it('does NOT filter out non-form field types (arrays, objects, references)', () => {
    const fields = [field('tags', 'array'), field('meta', 'object'), field('rel', 'reference')];
    expect(orderedPayloadFields(fields).map((f) => f.fieldId)).toEqual(['tags', 'meta', 'rel']);
  });
});

describe('isLikelyMarkdown', () => {
  it('detects a Markdown MIME type regardless of title', () => {
    expect(isLikelyMarkdown('notes.txt', 'text/markdown')).toBe(true);
    expect(isLikelyMarkdown(undefined, 'text/x-markdown')).toBe(true);
  });

  it('detects a Markdown title extension (case-insensitive)', () => {
    expect(isLikelyMarkdown('README.md')).toBe(true);
    expect(isLikelyMarkdown('Design.MARKDOWN')).toBe(true);
    // Browsers commonly report .md uploads as octet-stream — the extension
    // still wins over a generic (non-Markdown) MIME type.
    expect(isLikelyMarkdown('0042-decision.md', 'application/octet-stream')).toBe(true);
  });

  it('is false for non-Markdown titles and MIME types', () => {
    expect(isLikelyMarkdown('report.pdf', 'application/pdf')).toBe(false);
    expect(isLikelyMarkdown('plain notes')).toBe(false);
    expect(isLikelyMarkdown()).toBe(false);
  });
});

describe('isInlineViewableMarkdownFile', () => {
  it('accepts a Markdown file up to (and including) the fetch cap', () => {
    expect(isInlineViewableMarkdownFile('note.md', undefined, 1024)).toBe(true);
    expect(isInlineViewableMarkdownFile('note.md', undefined, FILE_INLINE_VIEW_MAX_BYTES)).toBe(
      true,
    );
    // fileSize may be 0/undefined while an upload is pending — still offered;
    // the fetch's error state covers a missing object.
    expect(isInlineViewableMarkdownFile('note.md', undefined, undefined)).toBe(true);
  });

  it('rejects oversized or non-Markdown files', () => {
    expect(
      isInlineViewableMarkdownFile('note.md', undefined, FILE_INLINE_VIEW_MAX_BYTES + 1),
    ).toBe(false);
    expect(isInlineViewableMarkdownFile('report.pdf', 'application/pdf', 1024)).toBe(false);
  });
});

describe('defaultTextView', () => {
  it('renders detected Markdown up to (and including) the size cap', () => {
    expect(defaultTextView('note.md', undefined, 10)).toBe('rendered');
    expect(defaultTextView('note.md', undefined, MARKDOWN_RENDER_DEFAULT_MAX_BYTES)).toBe(
      'rendered',
    );
  });

  it('falls back to raw above the size cap (the toggle still allows rendering)', () => {
    expect(defaultTextView('note.md', undefined, MARKDOWN_RENDER_DEFAULT_MAX_BYTES + 1)).toBe(
      'raw',
    );
  });

  it('defaults undetected content to raw regardless of size', () => {
    expect(defaultTextView('notes.txt', 'text/plain', 10)).toBe('raw');
  });
});
