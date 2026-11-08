// ---------------------------------------------------------------------------
// Whether a document has text to read or to ask about — shared by the documents
// list and the detail page.
//
// A file's text is extracted after the upload. Until that finishes `extraction`
// is absent and the text request answers 404; once it finishes, `extraction`
// says how it went. Only `OK` and `TRUNCATED` leave text behind: for any other
// outcome, including one added later, the API stores no text, answers the text
// request with 404 and refuses a question about the document with 409.
// ---------------------------------------------------------------------------

/** The only extraction outcomes that leave text behind. */
const TEXT_OUTCOMES: ReadonlySet<string> = new Set(['OK', 'TRUNCATED']);

/** `indexStatus` values of a file whose text is still being produced. */
const EXTRACTION_RUNNING: ReadonlySet<string> = new Set([
  'PENDING_UPLOAD',
  'UPLOADED',
  'EXTRACTING',
]);

/** The parts of a document response these checks read; a response is assignable to it, and so are plain strings. */
interface DocumentTextState {
  indexStatus?: string | undefined;
  extraction?: { outcome?: string | undefined } | undefined;
}

/** True when extraction finished and left no text. */
export function hasNoExtractedText(doc: DocumentTextState | undefined): boolean {
  const outcome = doc?.extraction?.outcome;
  return outcome !== undefined && !TEXT_OUTCOMES.has(outcome);
}

/** True while a file's text is still being extracted, so there is nothing to read or ask about yet. */
export function isTextExtractionRunning(doc: DocumentTextState | undefined): boolean {
  return (
    doc !== undefined &&
    doc.extraction === undefined &&
    doc.indexStatus !== undefined &&
    EXTRACTION_RUNNING.has(doc.indexStatus)
  );
}

/** Why a question about the document cannot be asked, or null when it can. */
export function askUnavailableReason(
  doc: DocumentTextState | undefined,
): 'noText' | 'pending' | null {
  if (hasNoExtractedText(doc)) return 'noText';
  if (isTextExtractionRunning(doc)) return 'pending';
  return null;
}
