// ---------------------------------------------------------------------------
// RecordsPage tests — schema picker + records table, with the SDK mocked.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CurrentTenantProvider } from '@vectros-ai/react';
import type { TenantMembership } from '@vectros-ai/react';

import { RecordsPage } from './RecordsPage';
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

function stub(api: {
  listSchemas?: () => Promise<unknown>;
  listRecords?: (req: unknown) => Promise<unknown>;
  lookupRecordsByBody?: (req: unknown) => Promise<unknown>;
}): void {
  mockedClient.mockReturnValue({
    schemas: { listSchemas: api.listSchemas ?? vi.fn().mockResolvedValue(pageOf([])) },
    records: {
      listRecords: api.listRecords ?? vi.fn().mockResolvedValue(pageOf([])),
      lookupRecordsByBody: api.lookupRecordsByBody ?? vi.fn().mockResolvedValue(pageOf([])),
    },
  } as never);
}

function renderPage(initialPath = '/records'): void {
  render(
    <TestProviders initialEntries={[initialPath]}>
      <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
        <CurrentContextProvider
          initialContexts={[{ contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' }]}
          initialContext="default"
        >
          <RecordsPage />
        </CurrentContextProvider>
      </CurrentTenantProvider>
    </TestProviders>,
  );
}

describe('RecordsPage', () => {
  beforeEach(() => mockedClient.mockReset());

  it('lists records of the first schema type with a link to detail', async () => {
    stub({
      listSchemas: vi
        .fn()
        .mockResolvedValue(pageOf([{ id: 's1', allowedSurfaces: ['record'], typeName: 'intake_form', displayName: 'Intake Form' }])),
      listRecords: vi
        .fn()
        .mockResolvedValue(pageOf([
          { id: 'rec_1', typeName: 'intake_form', status: 'ACTIVE', indexStatus: 'INDEXED' },
        ])),
    });

    renderPage();

    const link = await screen.findByRole('link', { name: 'rec_1' });
    expect(link).toHaveAttribute('href', '/records/rec_1');
    // Humanized index-status label (INDEXED → "Indexed").
    expect(screen.getByText('Indexed')).toBeInTheDocument();
  });

  it('restores the selected type from the ?type= URL param (persists across navigation)', async () => {
    const listRecords = vi.fn().mockResolvedValue(pageOf([]));
    stub({
      listSchemas: vi.fn().mockResolvedValue(
        pageOf([
          { id: 's1', allowedSurfaces: ['record'], typeName: 'intake_form', displayName: 'Intake Form' },
          { id: 's2', allowedSurfaces: ['record'], typeName: 'contact', displayName: 'Contact' },
        ]),
      ),
      listRecords,
    });

    // Mount as if returning from the editor with the type in the URL — NOT the
    // default first type. The picker reflects it and the records load for it.
    renderPage('/records?type=contact');

    expect(await screen.findByRole('combobox', { name: 'Record type' })).toHaveTextContent(
      'Contact',
    );
    await waitFor(() =>
      expect(listRecords).toHaveBeenCalledWith(expect.objectContaining({ type: 'contact' })),
    );
  });

  it('excludes document-only schemas from the record type picker', async () => {
    const user = userEvent.setup();
    stub({
      listSchemas: vi.fn().mockResolvedValue(
        pageOf([
          { id: 's1', allowedSurfaces: ['record'], typeName: 'intake_form', displayName: 'Intake Form' },
          // A DOCUMENT-surface type: its "records" don't exist, so offering it
          // here would 4xx on every interaction. It must not leak in.
          { id: 's9', allowedSurfaces: ['document'], typeName: 'smoke_doc_note', displayName: 'Smoke Doc Note' },
        ]),
      ),
      listRecords: vi.fn().mockResolvedValue(pageOf([])),
    });
    renderPage();

    await user.click(await screen.findByRole('combobox', { name: 'Record type' }));
    expect(await screen.findByRole('option', { name: 'Intake Form' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Smoke Doc Note' })).not.toBeInTheDocument();
  });

  it('refetches the records list when the refresh button is clicked', async () => {
    const user = userEvent.setup();
    const listRecords = vi
      .fn()
      .mockResolvedValue(pageOf([
        { id: 'rec_1', typeName: 'intake_form', status: 'ACTIVE', indexStatus: 'INDEXED' },
      ]));
    stub({
      listSchemas: vi.fn().mockResolvedValue(pageOf([{ id: 's1', allowedSurfaces: ['record'], typeName: 'intake_form' }])),
      listRecords,
    });
    renderPage();

    await screen.findByRole('link', { name: 'rec_1' });
    const before = listRecords.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Refresh records' }));
    await waitFor(() => expect(listRecords.mock.calls.length).toBeGreaterThan(before));
  });

  it('shows an empty state when the context has no schemas', async () => {
    stub({ listSchemas: vi.fn().mockResolvedValue(pageOf([])) });
    renderPage();
    expect(await screen.findByText(/no schemas defined/i)).toBeInTheDocument();
  });

  it('shows an empty state when the selected type has no records', async () => {
    stub({
      listSchemas: vi.fn().mockResolvedValue(pageOf([{ id: 's1', allowedSurfaces: ['record'], typeName: 'intake_form' }])),
      listRecords: vi.fn().mockResolvedValue(pageOf([])),
    });
    renderPage();
    expect(await screen.findByText(/no records of this type/i)).toBeInTheDocument();
  });

  it('shows an error state when records fail to load', async () => {
    stub({
      listSchemas: vi.fn().mockResolvedValue(pageOf([{ id: 's1', allowedSurfaces: ['record'], typeName: 'intake_form' }])),
      listRecords: vi.fn().mockRejectedValue(new Error('boom')),
    });
    renderPage();
    expect(await screen.findByText(/couldn.t load records/i)).toBeInTheDocument();
  });

  // --- schema-driven columns + sort/filter --------------------------------

  const SCHEMA_WITH_FIELDS = {
    id: 's1',
    allowedSurfaces: ['record'], typeName: 'intake_form',
    displayName: 'Intake Form',
    fields: [
      { fieldId: 'firstName', fieldType: 'string', filterable: true },
      { fieldId: 'age', fieldType: 'number' },
    ],
    renderHints: { firstName: { label: 'First name', order: 1 }, age: { order: 2 } },
  };
  const RECORDS = [
    {
      id: 'rec_b',
      typeName: 'intake_form',
      status: 'ACTIVE',
      payload: { firstName: 'Bob', age: 30 },
    },
    {
      id: 'rec_a',
      typeName: 'intake_form',
      status: 'ACTIVE',
      payload: { firstName: 'Ann', age: 50 },
    },
  ];

  it('renders schema-derived value columns with renderHints labels + values', async () => {
    stub({
      listSchemas: vi.fn().mockResolvedValue(pageOf([SCHEMA_WITH_FIELDS])),
      listRecords: vi.fn().mockResolvedValue(pageOf(RECORDS)),
    });
    renderPage();

    // Column header uses the renderHints label; cells render the payload values.
    expect(await screen.findByRole('columnheader', { name: /First name/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /^age/i })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Bob' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Ann' })).toBeInTheDocument();
  });

  it('sorts rows when a column header is clicked', async () => {
    const user = userEvent.setup();
    stub({
      listSchemas: vi.fn().mockResolvedValue(pageOf([SCHEMA_WITH_FIELDS])),
      listRecords: vi.fn().mockResolvedValue(pageOf(RECORDS)),
    });
    renderPage();

    await screen.findByRole('cell', { name: 'Bob' });
    // Click "First name" → ascending: Ann before Bob (records arrive Bob, Ann).
    await user.click(screen.getByRole('button', { name: /First name/ }));
    const firstNames = screen
      .getAllByRole('row')
      .slice(1) // drop header row
      .map((row) => within(row).getAllByRole('cell')[1]?.textContent);
    expect(firstNames).toEqual(['Ann', 'Bob']);
  });

  it('filters rows over the filterable fields', async () => {
    const user = userEvent.setup();
    stub({
      listSchemas: vi.fn().mockResolvedValue(pageOf([SCHEMA_WITH_FIELDS])),
      listRecords: vi.fn().mockResolvedValue(pageOf(RECORDS)),
    });
    renderPage();

    await screen.findByRole('cell', { name: 'Bob' });
    await user.type(screen.getByRole('textbox', { name: /filter records/i }), 'ann');
    expect(screen.getByRole('cell', { name: 'Ann' })).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'Bob' })).not.toBeInTheDocument();
  });

  // --- displayField headline promotion --------------------------------

  const SCHEMA_WITH_DISPLAY = {
    id: 's1',
    allowedSurfaces: ['record'], typeName: 'intake_form',
    displayName: 'Intake Form',
    fields: [
      { fieldId: 'fullName', fieldType: 'string' },
      { fieldId: 'age', fieldType: 'number' },
    ],
    renderHints: {
      fullName: { label: 'Full name', order: 1, displayField: true },
      age: { label: 'Age', order: 2 },
    },
  };

  it('promotes the displayField to the linked headline column with the id as a caption', async () => {
    stub({
      listSchemas: vi.fn().mockResolvedValue(pageOf([SCHEMA_WITH_DISPLAY])),
      listRecords: vi.fn().mockResolvedValue(pageOf([
        { id: 'rec_1', typeName: 'intake_form', status: 'ACTIVE', payload: { fullName: 'Ada Lovelace', age: 36 } },
      ])),
    });
    renderPage();

    // The headline link text is the displayField value, linking to the detail.
    const link = await screen.findByRole('link', { name: 'Ada Lovelace' });
    expect(link).toHaveAttribute('href', '/records/rec_1');
    // The raw id stays visible as a caption beneath the headline.
    expect(screen.getByText('rec_1')).toBeInTheDocument();
    // The headline column header is the displayField label, not the generic ID.
    expect(screen.getByRole('columnheader', { name: /Full name/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Record ID/i })).not.toBeInTheDocument();
    // The promoted field is NOT duplicated as a value column; `age` still is.
    expect(screen.getByRole('columnheader', { name: /Age/ })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader', { name: /Full name/ })).toHaveLength(1);
  });

  it('sorts by the promoted displayField column when its header is clicked', async () => {
    const user = userEvent.setup();
    stub({
      listSchemas: vi.fn().mockResolvedValue(pageOf([SCHEMA_WITH_DISPLAY])),
      listRecords: vi.fn().mockResolvedValue(pageOf([
        { id: 'rec_1', typeName: 'intake_form', status: 'ACTIVE', payload: { fullName: 'Bob', age: 1 } },
        { id: 'rec_2', typeName: 'intake_form', status: 'ACTIVE', payload: { fullName: 'Ann', age: 2 } },
      ])),
    });
    renderPage();

    await screen.findByRole('link', { name: 'Bob' });
    // Click the promoted headline header → ascending: Ann before Bob.
    await user.click(screen.getByRole('button', { name: /Full name/ }));
    const headlineLinks = screen
      .getAllByRole('row')
      .slice(1) // drop header row
      .map((row) => within(row).getAllByRole('link')[0]?.textContent);
    expect(headlineLinks).toEqual(['Ann', 'Bob']);
  });

  // --- server-side lookup (exact / range / prefix + order) ----------------

  const SCHEMA_WITH_LOOKUPS = {
    id: 's1',
    allowedSurfaces: ['record'], typeName: 'event',
    displayName: 'Event',
    fields: [{ fieldId: 'code', fieldType: 'string' }],
    lookupFields: [
      { fieldName: 'code', rangeEnabled: true },
      { fieldName: 'owner' }, // exact-only (not range-enabled)
    ],
  };

  it('runs a server-side range lookup with a sort direction', async () => {
    const user = userEvent.setup();
    const lookupSpy = vi.fn().mockResolvedValue(
      pageOf([{ id: 'rec_x', typeName: 'event', status: 'ACTIVE', payload: { code: 'B' } }]),
    );
    stub({
      listSchemas: vi.fn().mockResolvedValue(pageOf([SCHEMA_WITH_LOOKUPS])),
      listRecords: vi.fn().mockResolvedValue(
        pageOf([{ id: 'rec_list', typeName: 'event', status: 'ACTIVE', payload: { code: 'A' } }]),
      ),
      lookupRecordsByBody: lookupSpy,
    });
    renderPage();

    await screen.findByRole('link', { name: 'rec_list' });
    // Pick the range-enabled lookup field.
    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: /code/ }));
    // Range mode is offered (the field is range-enabled) → choose it.
    await user.click(screen.getByRole('combobox', { name: 'Match' }));
    await user.click(await screen.findByRole('option', { name: 'Range' }));
    await user.type(screen.getByRole('textbox', { name: 'From' }), 'A');
    await user.type(screen.getByRole('textbox', { name: 'To' }), 'M');
    // Descending order.
    await user.click(screen.getByRole('combobox', { name: 'Order' }));
    await user.click(await screen.findByRole('option', { name: 'Descending' }));
    await user.click(screen.getByRole('button', { name: 'Look up' }));

    await screen.findByRole('link', { name: 'rec_x' });
    expect(lookupSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'event', field: 'code', from: 'A', to: 'M', order: 'desc' }),
    );
  });

  it('runs a prefix lookup on a range-enabled field', async () => {
    const user = userEvent.setup();
    const lookupSpy = vi.fn().mockResolvedValue(
      pageOf([{ id: 'rec_p', typeName: 'event', status: 'ACTIVE', payload: { code: 'PO-1' } }]),
    );
    stub({
      listSchemas: vi.fn().mockResolvedValue(pageOf([SCHEMA_WITH_LOOKUPS])),
      listRecords: vi.fn().mockResolvedValue(pageOf([])),
      lookupRecordsByBody: lookupSpy,
    });
    renderPage();

    await screen.findByRole('combobox', { name: 'Look up by' });
    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: /code/ }));
    await user.click(screen.getByRole('combobox', { name: 'Match' }));
    await user.click(await screen.findByRole('option', { name: 'Prefix' }));
    await user.type(screen.getByRole('textbox', { name: 'Prefix' }), 'PO-');
    await user.click(screen.getByRole('button', { name: 'Look up' }));

    await screen.findByRole('link', { name: 'rec_p' });
    const call = lookupSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(call).toMatchObject({ type: 'event', field: 'code', prefix: 'PO-', order: 'asc' });
    expect(call.value).toBeUndefined();
    expect(call.from).toBeUndefined();
  });

  it('offers exact-only (no range/prefix) for a non-range-enabled lookup field', async () => {
    const user = userEvent.setup();
    const lookupSpy = vi.fn().mockResolvedValue(
      pageOf([{ id: 'rec_o', typeName: 'event', status: 'ACTIVE', payload: { code: 'Z' } }]),
    );
    stub({
      listSchemas: vi.fn().mockResolvedValue(pageOf([SCHEMA_WITH_LOOKUPS])),
      listRecords: vi.fn().mockResolvedValue(pageOf([])),
      lookupRecordsByBody: lookupSpy,
    });
    renderPage();

    await screen.findByRole('combobox', { name: 'Look up by' });
    await user.click(screen.getByRole('combobox', { name: 'Look up by' }));
    await user.click(await screen.findByRole('option', { name: 'owner' }));
    // No "Match" mode select for an exact-only field — just a value input.
    expect(screen.queryByRole('combobox', { name: 'Match' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'acme');
    await user.click(screen.getByRole('button', { name: 'Look up' }));

    await screen.findByRole('link', { name: 'rec_o' });
    expect(lookupSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'event', field: 'owner', value: 'acme', order: 'asc' }),
    );
    // The exact lookup must NOT send range/prefix bounds.
    const call = lookupSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.from).toBeUndefined();
    expect(call.prefix).toBeUndefined();
  });

  it('falls back to the id headline when the displayField value is blank', async () => {
    stub({
      listSchemas: vi.fn().mockResolvedValue(pageOf([SCHEMA_WITH_DISPLAY])),
      listRecords: vi.fn().mockResolvedValue(pageOf([
        { id: 'rec_2', typeName: 'intake_form', status: 'ACTIVE', payload: { age: 36 } },
      ])),
    });
    renderPage();

    // No displayField value → the id is the link text (no duplicate caption).
    const link = await screen.findByRole('link', { name: 'rec_2' });
    expect(link).toHaveAttribute('href', '/records/rec_2');
  });
});
