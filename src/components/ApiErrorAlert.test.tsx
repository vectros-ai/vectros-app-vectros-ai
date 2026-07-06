// ---------------------------------------------------------------------------
// ApiErrorAlert / RequestIdCaption tests — the RENDER-level contract (the pure
// extractor is covered separately in lib/apiError.test.ts): the alert announces
// (role="alert"), shows the friendly message, and surfaces the
// requestId reference line when (and only when) the error carries one.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { ApiErrorAlert } from './ApiErrorAlert';
import { RequestIdCaption } from './RequestIdCaption';
import { TestProviders } from '../test/TestProviders';

const withRequestId = { statusCode: 500, body: { message: 'oops', requestId: 'corr-abc-123' } };
const withoutRequestId = { statusCode: 500, body: { message: 'oops' } };

describe('ApiErrorAlert', () => {
  it('announces, shows the message, and surfaces the requestId reference', () => {
    render(
      <TestProviders>
        <ApiErrorAlert error={withRequestId}>Something went wrong.</ApiErrorAlert>
      </TestProviders>,
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Something went wrong.')).toBeInTheDocument();
    expect(within(alert).getByText(/reference id:\s*corr-abc-123/i)).toBeInTheDocument();
  });

  it('omits the reference line when the error carries no requestId', () => {
    render(
      <TestProviders>
        <ApiErrorAlert error={withoutRequestId}>Something went wrong.</ApiErrorAlert>
      </TestProviders>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/reference id:/i)).not.toBeInTheDocument();
  });
});

describe('RequestIdCaption', () => {
  it('renders the reference line for an error that carries a requestId', () => {
    render(
      <TestProviders>
        <RequestIdCaption error={withRequestId} />
      </TestProviders>,
    );
    expect(screen.getByText(/reference id:\s*corr-abc-123/i)).toBeInTheDocument();
  });

  it('renders nothing when there is no requestId', () => {
    const { container } = render(
      <TestProviders>
        <RequestIdCaption error={new Error('network')} />
      </TestProviders>,
    );
    expect(container).not.toHaveTextContent(/reference id/i);
  });
});
