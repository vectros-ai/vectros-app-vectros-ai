// ---------------------------------------------------------------------------
// useInferenceModels tests — fetches the model registry scoped to the active
// (tenant, context), with the SDK client mocked.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { CurrentTenantProvider } from '@vectros-ai/react';
import type { TenantMembership } from '@vectros-ai/react';

import { useInferenceModels } from './useInferenceModels';
import { CurrentContextProvider } from '../auth/CurrentContextProvider';
import { TestProviders } from '../test/TestProviders';

vi.mock('../api/vectrosApi', () => ({ vectrosApiClient: vi.fn() }));
import { vectrosApiClient } from '../api/vectrosApi';

const mockedClient = vi.mocked(vectrosApiClient);
const TENANT = 'tnt_0001';

const OWNER: TenantMembership = {
  tenantId: TENANT,
  tenantName: 'Test Org',
  tenantKind: 'test',
  role: 'OWNER',
  status: 'ACTIVE',
  partnerId: 'ptr_0001',
};

function wrapper({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <TestProviders>
      <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
        <CurrentContextProvider
          initialContexts={[{ contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' }]}
          initialContext="default"
        >
          {children}
        </CurrentContextProvider>
      </CurrentTenantProvider>
    </TestProviders>
  );
}

describe('useInferenceModels', () => {
  beforeEach(() => mockedClient.mockReset());

  it('fetches the registry scoped to the active (tenant, context)', async () => {
    const listInferenceModels = vi.fn().mockResolvedValue({
      defaultModel: 'haiku',
      models: [{ id: 'haiku', name: 'Claude Haiku' }],
    });
    mockedClient.mockReturnValue({ inference: { listInferenceModels } } as never);

    const { result } = renderHook(() => useInferenceModels(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.defaultModel).toBe('haiku');
    expect(listInferenceModels).toHaveBeenCalledTimes(1);
    expect(mockedClient).toHaveBeenCalledWith(TENANT, 'default');
  });
});
