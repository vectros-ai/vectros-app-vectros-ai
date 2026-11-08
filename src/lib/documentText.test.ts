import { describe, expect, it } from 'vitest';
import { askUnavailableReason, hasNoExtractedText, isTextExtractionRunning } from './documentText';

describe('documentText', () => {
  it.each(['OK', 'TRUNCATED'])('an extraction outcome of %s leaves text', (outcome) => {
    const doc = { indexStatus: 'INDEXED', extraction: { outcome } };
    expect(hasNoExtractedText(doc)).toBe(false);
    expect(askUnavailableReason(doc)).toBeNull();
  });

  it.each(['NO_TEXT', 'ENCRYPTED', 'UNSUPPORTED', 'TOO_LARGE', 'UNREADABLE', 'A_NEW_OUTCOME'])(
    'an extraction outcome of %s leaves no text',
    (outcome) => {
      const doc = { indexStatus: 'SKIPPED', extraction: { outcome } };
      expect(hasNoExtractedText(doc)).toBe(true);
      expect(askUnavailableReason(doc)).toBe('noText');
    },
  );

  it.each(['PENDING_UPLOAD', 'UPLOADED', 'EXTRACTING'])(
    'a file whose extraction has not reported yet is pending while it is %s',
    (indexStatus) => {
      const doc = { indexStatus };
      expect(isTextExtractionRunning(doc)).toBe(true);
      expect(askUnavailableReason(doc)).toBe('pending');
    },
  );

  it.each(['PENDING_INDEX', 'INDEXED', 'STORED', 'FAILED'])(
    'a document with no extraction reported is not pending when it is %s (text ingested, or extracted before the field existed)',
    (indexStatus) => {
      const doc = { indexStatus };
      expect(isTextExtractionRunning(doc)).toBe(false);
      expect(askUnavailableReason(doc)).toBeNull();
    },
  );

  it('a reported extraction ends the pending state', () => {
    expect(
      isTextExtractionRunning({ indexStatus: 'EXTRACTING', extraction: { outcome: 'OK' } }),
    ).toBe(false);
  });

  it('an unknown document has nothing to say', () => {
    expect(hasNoExtractedText(undefined)).toBe(false);
    expect(isTextExtractionRunning(undefined)).toBe(false);
    expect(askUnavailableReason(undefined)).toBeNull();
  });
});
