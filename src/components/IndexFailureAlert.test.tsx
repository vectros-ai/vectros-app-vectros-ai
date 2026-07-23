// ---------------------------------------------------------------------------
// IndexFailureAlert tests — render gate, message vs fallback, severity by code.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { IndexFailureAlert, type IndexFailureLike } from './IndexFailureAlert';
import { TestProviders } from '../test/TestProviders';

function renderAlert(
  indexStatus: string | undefined,
  indexFailure: IndexFailureLike | undefined,
): HTMLElement {
  const { container } = render(
    <TestProviders>
      <IndexFailureAlert indexStatus={indexStatus} indexFailure={indexFailure} />
    </TestProviders>,
  );
  return container;
}

describe('IndexFailureAlert', () => {
  it('renders nothing unless the status is FAILED', () => {
    expect(renderAlert('INDEXED', undefined).textContent).toBe('');
    expect(
      renderAlert('PENDING_INDEX', { code: 'TEXT_INDEX_FAILED', message: 'x' }).textContent,
    ).toBe('');
    expect(renderAlert(undefined, undefined).textContent).toBe('');
  });

  it('shows the backend message on a FAILED item that carries one', () => {
    renderAlert('FAILED', {
      code: 'INDEXING_FAILED',
      message: 'No index leg is serving this content.',
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No index leg is serving this content.',
    );
  });

  it('falls back to a generic line when FAILED with no reason attached', () => {
    renderAlert('FAILED', undefined);
    // The i18n fallback, not an empty alert.
    expect(screen.getByRole('alert')).toHaveTextContent(/indexing failed/i);
  });

  it('falls back to the generic line when the message is only whitespace', () => {
    renderAlert('FAILED', { code: 'INDEXING_FAILED', message: '   ' });
    expect(screen.getByRole('alert')).toHaveTextContent(/indexing failed/i);
  });

  it('uses a warning severity for a still-partly-findable code', () => {
    renderAlert('FAILED', { code: 'VECTOR_LIMIT_EXCEEDED', message: 'Vector limit reached.' });
    expect(screen.getByRole('alert').className).toContain('MuiAlert-standardWarning');
  });

  it('uses an error severity for a fully-broken code', () => {
    renderAlert('FAILED', { code: 'SOURCE_UNAVAILABLE', message: 'Source is gone.' });
    expect(screen.getByRole('alert').className).toContain('MuiAlert-standardError');
  });

  it('defaults to error severity when no code is present', () => {
    renderAlert('FAILED', { message: 'Something failed.' });
    expect(screen.getByRole('alert').className).toContain('MuiAlert-standardError');
  });
});
