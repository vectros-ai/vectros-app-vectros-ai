// ---------------------------------------------------------------------------
// RecordDetailPage tests — metadata + payload, with the SDK mocked.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { CurrentTenantProvider } from '@vectros-ai/react';
import type { TenantMembership } from '@vectros-ai/react';

import { RecordDetailPage } from './RecordDetailPage';
import { CurrentContextProvider } from '../../auth/CurrentContextProvider';
import { TestProviders } from '../../test/TestProviders';
import { pageOf } from '../../test/pageOf';

vi.mock('../../api/vectrosApi', () => ({ vectrosApiClient: vi.fn() }));
import { vectrosApiClient } from '../../api/vectrosApi';

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

interface RecordsStub {
  getRecord: (req: { id: string }) => Promise<unknown>;
  deleteRecord?: (req: { id: string }) => Promise<void>;
  patchRecord?: (req: unknown) => Promise<unknown>;
  getRecordVersions?: (req: { id: string }) => Promise<unknown>;
}

function stubRecords(records: RecordsStub): void {
  mockedClient.mockReturnValue({
    // Default the history call so the detail page's version query resolves;
    // individual tests override it when they assert on the history view.
    records: { getRecordVersions: vi.fn().mockResolvedValue(pageOf([])), ...records },
  } as never);
}

function stubGetRecord(getRecord: (req: { id: string }) => Promise<unknown>): void {
  stubRecords({ getRecord });
}

/** Stub records + schemas + a reference lookup (for the field-model views). */
function stubFull(opts: {
  getRecord: (req: { id: string }) => Promise<unknown>;
  listSchemas?: () => Promise<unknown>;
  lookupRecords?: (req: { type: string; field: string; value: string }) => Promise<unknown>;
  getRecordVersions?: (req: { id: string }) => Promise<unknown>;
}): void {
  mockedClient.mockReturnValue({
    records: {
      getRecord: opts.getRecord,
      lookupRecords: opts.lookupRecords ?? vi.fn().mockResolvedValue(pageOf([])),
      getRecordVersions: opts.getRecordVersions ?? vi.fn().mockResolvedValue(pageOf([])),
    },
    schemas: { listSchemas: opts.listSchemas ?? vi.fn().mockResolvedValue(pageOf([])) },
  } as never);
}

function renderDetail(): void {
  render(
    <TestProviders initialEntries={['/records/rec_1']}>
      <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
        <CurrentContextProvider
          initialContexts={[{ contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' }]}
          initialContext="default"
        >
          <Routes>
            <Route path="/records/:recordId" element={<RecordDetailPage />} />
            <Route path="/records" element={<div>records list</div>} />
          </Routes>
        </CurrentContextProvider>
      </CurrentTenantProvider>
    </TestProviders>,
  );
}

describe('RecordDetailPage', () => {
  beforeEach(() => mockedClient.mockReset());

  it('shows a labeled loading state while the record is fetching', () => {
    stubGetRecord(vi.fn().mockReturnValue(new Promise(() => {})));
    renderDetail();
    expect(screen.getByRole('progressbar', { name: /loading record/i })).toBeInTheDocument();
  });

  it('renders the record metadata and its payload as JSON', async () => {
    stubGetRecord(
      vi.fn().mockResolvedValue({
        id: 'rec_1',
        typeName: 'intake_form',
        schemaId: 'schema_abc',
        status: 'ACTIVE',
        version: 3,
        payload: { firstName: 'Alice' },
      }),
    );

    renderDetail();

    expect(await screen.findByRole('heading', { name: 'rec_1' })).toBeInTheDocument();
    expect(screen.getByText('schema_abc')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    // Payload rendered as formatted JSON.
    expect(screen.getByText(/"firstName": "Alice"/)).toBeInTheDocument();
  });

  it('shows an error state when the record fails to load', async () => {
    stubGetRecord(vi.fn().mockRejectedValue(new Error('404')));
    renderDetail();
    expect(await screen.findByText(/couldn't load this record/i)).toBeInTheDocument();
  });

  it('renders the audit-trail history with change types and changed fields', async () => {
    stubFull({
      getRecord: vi.fn().mockResolvedValue({ id: 'rec_1', typeName: 'intake', version: 2 }),
      getRecordVersions: vi.fn().mockResolvedValue(
        pageOf([
          {
            id: 'v1',
            changeType: 'CREATE',
            changedBy: 'user_a',
            createdAt: '2026-06-10T10:00:00Z',
          },
          {
            id: 'v2',
            changeType: 'UPDATE',
            changedBy: 'user_b',
            createdAt: '2026-06-12T10:00:00Z',
            previousVersion: 1,
            changedFields: { fields: ['status', 'notes'] },
          },
        ]),
      ),
    });

    renderDetail();

    // Scope to the History region — "Created"/"Updated" also appear as metadata
    // field labels elsewhere on the page.
    const history = await screen.findByRole('region', { name: 'History' });
    expect(within(history).getByText('Created')).toBeInTheDocument();
    expect(within(history).getByText('Updated')).toBeInTheDocument();
    // The field-level diff surfaces the changed field names.
    expect(within(history).getByText(/Changed: status, notes/)).toBeInTheDocument();
  });

  it('shows an empty-history message when there are no versions', async () => {
    stubFull({
      getRecord: vi.fn().mockResolvedValue({ id: 'rec_1', typeName: 'intake', version: 1 }),
      getRecordVersions: vi.fn().mockResolvedValue(pageOf([])),
    });
    renderDetail();
    expect(await screen.findByText(/no history yet/i)).toBeInTheDocument();
  });

  it('links Edit to the record editor route', async () => {
    stubGetRecord(vi.fn().mockResolvedValue({ id: 'rec_1', typeName: 'intake_form', version: 1 }));
    renderDetail();
    const editLink = await screen.findByRole('link', { name: 'Edit' });
    expect(editLink).toHaveAttribute('href', '/records/rec_1/edit');
  });

  it('archives via the confirm dialog, sending ONLY the status in the patch', async () => {
    const user = userEvent.setup();
    const patchRecord = vi.fn().mockResolvedValue({ id: 'rec_1', status: 'ARCHIVED' });
    stubRecords({
      getRecord: vi
        .fn()
        .mockResolvedValue({ id: 'rec_1', typeName: 'intake_form', status: 'ACTIVE', version: 1 }),
      patchRecord,
    });
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    // The dialog says what archiving means before anything happens.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/pulled from search/i);
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    // Merge-patch: only `status` — the payload and other fields ride along.
    await waitFor(() =>
      expect(patchRecord).toHaveBeenCalledWith({ id: 'rec_1', body: { status: 'ARCHIVED' } }),
    );
  });

  it('shows the archived banner and restores with one click when archived', async () => {
    const user = userEvent.setup();
    const patchRecord = vi.fn().mockResolvedValue({ id: 'rec_1', status: 'ACTIVE' });
    stubRecords({
      getRecord: vi
        .fn()
        .mockResolvedValue({ id: 'rec_1', typeName: 'intake_form', status: 'ARCHIVED', version: 2 }),
      patchRecord,
    });
    renderDetail();

    // The archived state is explained, and Archive is replaced by Restore.
    expect(await screen.findByText(/excluded from search/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() =>
      expect(patchRecord).toHaveBeenCalledWith({ id: 'rec_1', body: { status: 'ACTIVE' } }),
    );
  });

  it('deletes the record after confirmation, then navigates to the list', async () => {
    const user = userEvent.setup();
    const deleteRecord = vi.fn().mockResolvedValue(undefined);
    stubRecords({
      getRecord: vi.fn().mockResolvedValue({ id: 'rec_1', typeName: 'intake_form', version: 1 }),
      deleteRecord,
    });
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    // Confirm dialog → confirm button.
    await user.click(await screen.findByRole('button', { name: 'Delete record' }));

    await waitFor(() => expect(deleteRecord).toHaveBeenCalledWith({ id: 'rec_1' }));
    expect(await screen.findByText('records list')).toBeInTheDocument();
  });

  it('keeps the dialog open and shows the failure IN-dialog when delete fails', async () => {
    const user = userEvent.setup();
    const deleteRecord = vi.fn().mockRejectedValue(new Error('boom'));
    stubRecords({
      getRecord: vi.fn().mockResolvedValue({ id: 'rec_1', typeName: 'intake_form', version: 1 }),
      deleteRecord,
    });
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete record' }));

    // The error renders INSIDE the still-open dialog (not occluded behind it).
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t delete this record/i);
    expect(screen.queryByText('records list')).not.toBeInTheDocument();
  });

  // --- field-model views: displayField title + reference cross-links -----

  it('uses the schema displayField value as the page title, keeping the id visible', async () => {
    stubFull({
      getRecord: vi.fn().mockResolvedValue({
        id: 'rec_1',
        typeName: 'intake_form',
        version: 1,
        payload: { fullName: 'Ada Lovelace' },
      }),
      listSchemas: vi.fn().mockResolvedValue(
        pageOf([
          {
            id: 's1',
            typeName: 'intake_form',
            fields: [{ fieldId: 'fullName', fieldType: 'string' }],
            renderHints: { fullName: { displayField: true } },
          },
        ]),
      ),
    });

    renderDetail();

    // Title is the displayField value, not the raw id...
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    // ...and the id still appears (as the subtitle).
    expect(screen.getByText('rec_1')).toBeInTheDocument();
  });

  it('renders a reference field as a cross-link to the resolved target record', async () => {
    const lookupRecords = vi
      .fn()
      .mockResolvedValue(pageOf([{ id: 'emp_99', typeName: 'employee' }]));
    stubFull({
      getRecord: vi.fn().mockResolvedValue({
        id: 'rec_1',
        typeName: 'intake_form',
        version: 1,
        payload: { manager: 'mgr-ext-1' },
      }),
      listSchemas: vi.fn().mockResolvedValue(
        pageOf([
          {
            id: 's1',
            typeName: 'intake_form',
            fields: [
              {
                fieldId: 'manager',
                fieldType: 'reference',
                targetTypeName: 'employee',
                targetField: 'externalId',
              },
            ],
            renderHints: { manager: { label: 'Manager' } },
          },
        ]),
      ),
      lookupRecords,
    });

    renderDetail();

    const link = await screen.findByRole('link', { name: 'mgr-ext-1' });
    expect(link).toHaveAttribute('href', '/records/emp_99');
    expect(lookupRecords).toHaveBeenCalledWith({
      type: 'employee',
      field: 'externalId',
      value: 'mgr-ext-1',
    });
  });

  it('shows the raw value (never a dead link) when a reference cannot be resolved', async () => {
    stubFull({
      getRecord: vi.fn().mockResolvedValue({
        id: 'rec_1',
        typeName: 'intake_form',
        version: 1,
        payload: { manager: 'ghost' },
      }),
      listSchemas: vi.fn().mockResolvedValue(
        pageOf([
          {
            id: 's1',
            typeName: 'intake_form',
            fields: [{ fieldId: 'manager', fieldType: 'reference', targetTypeName: 'employee' }],
            renderHints: {},
          },
        ]),
      ),
      lookupRecords: vi.fn().mockResolvedValue(pageOf([])), // no match
    });

    renderDetail();

    // The value is shown so the data isn't lost...
    expect(await screen.findByText('ghost')).toBeInTheDocument();
    // ...but it is not a link.
    expect(screen.queryByRole('link', { name: 'ghost' })).not.toBeInTheDocument();
  });

  it('renders each value of a cardinality-many reference as its own cross-link', async () => {
    const lookupRecords = vi.fn((req: { type: string; field: string; value: string }) =>
      Promise.resolve(
        pageOf(req.value === 'a' ? [{ id: 'rec_a' }] : req.value === 'b' ? [{ id: 'rec_b' }] : []),
      ),
    );
    stubFull({
      getRecord: vi.fn().mockResolvedValue({
        id: 'rec_1',
        typeName: 'intake_form',
        version: 1,
        payload: { tags: ['a', 'b'] },
      }),
      listSchemas: vi.fn().mockResolvedValue(
        pageOf([
          {
            id: 's1',
            typeName: 'intake_form',
            fields: [
              {
                fieldId: 'tags',
                fieldType: 'reference',
                targetTypeName: 'tag',
                targetField: 'slug',
                cardinality: 'many',
              },
            ],
            renderHints: { tags: { label: 'Tags' } },
          },
        ]),
      ),
      lookupRecords,
    });

    renderDetail();

    expect(await screen.findByRole('link', { name: 'a' })).toHaveAttribute(
      'href',
      '/records/rec_a',
    );
    expect(await screen.findByRole('link', { name: 'b' })).toHaveAttribute(
      'href',
      '/records/rec_b',
    );
    expect(lookupRecords).toHaveBeenCalledWith({ type: 'tag', field: 'slug', value: 'a' });
    expect(lookupRecords).toHaveBeenCalledWith({ type: 'tag', field: 'slug', value: 'b' });
  });

  it('renders an object-valued displayField title as compact JSON, not [object Object]', async () => {
    stubFull({
      getRecord: vi.fn().mockResolvedValue({
        id: 'rec_1',
        typeName: 'intake_form',
        version: 1,
        payload: { meta: { x: 1 } },
      }),
      listSchemas: vi.fn().mockResolvedValue(
        pageOf([
          {
            id: 's1',
            typeName: 'intake_form',
            fields: [{ fieldId: 'meta', fieldType: 'object' }],
            renderHints: { meta: { displayField: true } },
          },
        ]),
      ),
    });

    renderDetail();

    expect(await screen.findByRole('heading', { name: '{"x":1}' })).toBeInTheDocument();
  });
});
