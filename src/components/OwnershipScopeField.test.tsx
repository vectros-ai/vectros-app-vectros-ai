// ---------------------------------------------------------------------------
// OwnershipScopeField tests — the create-time ownership selector reports the
// right wire `scopes` value (undefined | [] | [..]) and validity.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { OwnershipScopeField } from './OwnershipScopeField';
import type { OwnershipScopeSelection } from './OwnershipScopeField';
import { TestProviders } from '../test/TestProviders';

function renderField(): { onChange: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn<(selection: OwnershipScopeSelection) => void>();
  render(
    <TestProviders>
      <OwnershipScopeField onChange={onChange} />
    </TestProviders>,
  );
  return { onChange };
}

const last = (onChange: ReturnType<typeof vi.fn>): OwnershipScopeSelection =>
  onChange.mock.calls.at(-1)?.[0] as OwnershipScopeSelection;

describe('OwnershipScopeField', () => {
  it('defaults to Inherit — reports scopes:undefined, valid', () => {
    const { onChange } = renderField();
    expect(last(onChange)).toEqual({ scopes: undefined, valid: true });
  });

  it('Private reports scopes:[] (owned by the user alone)', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField();
    await user.click(screen.getByRole('radio', { name: /private/i }));
    expect(last(onChange)).toEqual({ scopes: [], valid: true });
  });

  it('Custom with one entry reports the namespace:value scope', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField();
    await user.click(screen.getByRole('radio', { name: /custom scopes/i }));
    await user.type(screen.getByRole('textbox', { name: /namespace/i }), 'group');
    await user.type(screen.getByRole('textbox', { name: /^value$/i }), 'eng-team');
    expect(last(onChange)).toEqual({ scopes: ['group:eng-team'], valid: true });
  });

  it('Custom with a reserved namespace is invalid and shows an error', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField();
    await user.click(screen.getByRole('radio', { name: /custom scopes/i }));
    await user.type(screen.getByRole('textbox', { name: /namespace/i }), 'tenant');
    await user.type(screen.getByRole('textbox', { name: /^value$/i }), 'x');
    expect(last(onChange).valid).toBe(false);
    expect(await screen.findByRole('alert')).toHaveTextContent(/reserved/i);
  });

  it('Custom with no completed entry is invalid (steer to Private)', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField();
    await user.click(screen.getByRole('radio', { name: /custom scopes/i }));
    expect(last(onChange).valid).toBe(false);
  });
});
