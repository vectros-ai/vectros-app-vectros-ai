// ---------------------------------------------------------------------------
// RecordEditorPage tests — create, edit (with expectedVersion), and the 409
// version-conflict reload/overwrite affordance. The SDK is mocked.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useParams } from 'react-router';
import { CurrentTenantProvider } from '@vectros-ai/react';
import type { TenantMembership } from '@vectros-ai/react';

import { RecordEditorPage } from './RecordEditorPage';
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

/** A stand-in detail page so we can assert post-save navigation by URL. */
function DetailMarker(): React.JSX.Element {
  const { recordId } = useParams();
  return <div>detail:{recordId}</div>;
}

function renderEditor(initialPath: string, client: unknown): void {
  mockedClient.mockReturnValue(client as never);
  render(
    <TestProviders initialEntries={[initialPath]}>
      <CurrentTenantProvider initialMemberships={[OWNER]} initialTenant={TENANT}>
        <CurrentContextProvider
          initialContexts={[{ contextId: 'default', name: 'Default', tenantId: TENANT, tenantKind: 'test' }]}
          initialContext="default"
        >
          <Routes>
            <Route path="/records/new" element={<RecordEditorPage />} />
            <Route path="/records/:recordId/edit" element={<RecordEditorPage />} />
            <Route path="/records/:recordId" element={<DetailMarker />} />
            <Route path="/records" element={<div>records list</div>} />
          </Routes>
        </CurrentContextProvider>
      </CurrentTenantProvider>
    </TestProviders>,
  );
}

describe('RecordEditorPage — create', () => {
  beforeEach(() => mockedClient.mockReset());

  it('creates a record against the selected schema and navigates to its detail', async () => {
    const user = userEvent.setup();
    const createRecord = vi.fn().mockResolvedValue({ id: 'rec_new', typeName: 'intake_form' });
    const listSchemas = vi
      .fn()
      .mockResolvedValue(pageOf([{ id: 'schema_abc', allowedSurfaces: ['record'], typeName: 'intake_form', displayName: 'Intake' }]));
    renderEditor('/records/new', { schemas: { listSchemas }, records: { createRecord } });

    // Pick the schema (type).
    await user.click(await screen.findByLabelText('Record type'));
    await user.click(await screen.findByRole('option', { name: 'Intake' }));

    // Author a payload.
    fireEvent.change(screen.getByLabelText('Payload (JSON)'), {
      target: { value: '{"firstName":"Alice"}' },
    });

    await user.click(screen.getByRole('button', { name: 'Create record' }));

    await waitFor(() =>
      expect(createRecord).toHaveBeenCalledWith({
        body: {
          typeName: 'intake_form',
          schemaId: 'schema_abc',
          payload: { firstName: 'Alice' },
        },
      }),
    );
    expect(await screen.findByText('detail:rec_new')).toBeInTheDocument();
  });

  it('strips reserved identifier keys from the create payload', async () => {
    const user = userEvent.setup();
    const createRecord = vi.fn().mockResolvedValue({ id: 'rec_new', typeName: 'intake_form' });
    const listSchemas = vi
      .fn()
      .mockResolvedValue(pageOf([{ id: 'schema_abc', allowedSurfaces: ['record'], typeName: 'intake_form', displayName: 'Intake' }]));
    renderEditor('/records/new', { schemas: { listSchemas }, records: { createRecord } });

    await user.click(await screen.findByLabelText('Record type'));
    await user.click(await screen.findByRole('option', { name: 'Intake' }));

    // A raw payload that (wrongly) carries reserved top-level identifiers.
    fireEvent.change(screen.getByLabelText('Payload (JSON)'), {
      target: { value: '{"firstName":"Alice","externalId":"x","orgId":"o","userId":"u"}' },
    });
    await user.click(screen.getByRole('button', { name: 'Create record' }));

    // The reserved keys are stripped — only the real payload field is sent.
    await waitFor(() =>
      expect(createRecord).toHaveBeenCalledWith({
        body: {
          typeName: 'intake_form',
          schemaId: 'schema_abc',
          payload: { firstName: 'Alice' },
        },
      }),
    );
  });

  it('pre-selects the schema from the ?type= deep link', async () => {
    const user = userEvent.setup();
    const createRecord = vi.fn().mockResolvedValue({ id: 'rec_new', typeName: 'intake_form' });
    const listSchemas = vi.fn().mockResolvedValue(
      pageOf([
        { id: 'schema_abc', allowedSurfaces: ['record'], typeName: 'intake_form', displayName: 'Intake' },
        { id: 'schema_def', allowedSurfaces: ['record'], typeName: 'contact', displayName: 'Contact' },
      ]),
    );
    renderEditor('/records/new?type=intake_form', {
      schemas: { listSchemas },
      records: { createRecord },
    });

    // No manual pick — the deep link defaulted the type to Intake.
    expect(await screen.findByLabelText('Record type')).toHaveTextContent('Intake');

    fireEvent.change(screen.getByLabelText('Payload (JSON)'), {
      target: { value: '{"firstName":"Alice"}' },
    });
    await user.click(screen.getByRole('button', { name: 'Create record' }));

    await waitFor(() =>
      expect(createRecord).toHaveBeenCalledWith({
        body: {
          typeName: 'intake_form',
          schemaId: 'schema_abc',
          payload: { firstName: 'Alice' },
        },
      }),
    );
  });

  it('excludes document-only schemas from the create type picker', async () => {
    const user = userEvent.setup();
    const listSchemas = vi.fn().mockResolvedValue(
      pageOf([
        { id: 'schema_abc', allowedSurfaces: ['record'], typeName: 'intake_form', displayName: 'Intake' },
        // A DOCUMENT-surface type is not a valid record create target.
        { id: 'schema_doc', allowedSurfaces: ['document'], typeName: 'smoke_doc_note', displayName: 'Smoke Doc Note' },
      ]),
    );
    renderEditor('/records/new', { schemas: { listSchemas } });

    await user.click(await screen.findByLabelText('Record type'));
    expect(await screen.findByRole('option', { name: 'Intake' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Smoke Doc Note' })).not.toBeInTheDocument();
  });

  it('sends the dedicated External ID field as a top-level request field', async () => {
    const user = userEvent.setup();
    const createRecord = vi.fn().mockResolvedValue({ id: 'rec_new', typeName: 'intake_form' });
    const listSchemas = vi
      .fn()
      .mockResolvedValue(pageOf([{ id: 'schema_abc', allowedSurfaces: ['record'], typeName: 'intake_form', displayName: 'Intake' }]));
    renderEditor('/records/new', { schemas: { listSchemas }, records: { createRecord } });

    await user.click(await screen.findByLabelText('Record type'));
    await user.click(await screen.findByRole('option', { name: 'Intake' }));

    fireEvent.change(screen.getByLabelText('Payload (JSON)'), {
      target: { value: '{"name":"TEST 1"}' },
    });
    await user.type(screen.getByLabelText('External ID (optional)'), 'CNV-1');
    await user.click(screen.getByRole('button', { name: 'Create record' }));

    // externalId is a first-class request field (under `body`), NOT a payload key.
    await waitFor(() =>
      expect(createRecord).toHaveBeenCalledWith({
        body: {
          typeName: 'intake_form',
          schemaId: 'schema_abc',
          payload: { name: 'TEST 1' },
          externalId: 'CNV-1',
        },
      }),
    );
  });

  it('disables save while the payload is invalid JSON', async () => {
    const listSchemas = vi
      .fn()
      .mockResolvedValue(pageOf([{ id: 'schema_abc', allowedSurfaces: ['record'], typeName: 'intake_form', displayName: 'Intake' }]));
    renderEditor('/records/new', { schemas: { listSchemas }, records: { createRecord: vi.fn() } });

    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Record type'));
    await user.click(await screen.findByRole('option', { name: 'Intake' }));

    fireEvent.change(screen.getByLabelText('Payload (JSON)'), { target: { value: '{ broken' } });

    expect(screen.getByRole('button', { name: 'Create record' })).toBeDisabled();
    expect(screen.getByText(/isn't valid JSON/i)).toBeInTheDocument();
  });
});

describe('RecordEditorPage — schema-driven form view', () => {
  beforeEach(() => mockedClient.mockReset());

  const SCHEMA_WITH_FIELDS = {
    id: 'schema_abc',
    allowedSurfaces: ['record'], typeName: 'intake_form',
    displayName: 'Intake',
    fields: [{ fieldId: 'firstName', fieldType: 'string', required: true }],
  };

  it('renders a typed form, gates save on required fields, and writes through to the payload', async () => {
    const user = userEvent.setup();
    const createRecord = vi.fn().mockResolvedValue({ id: 'rec_new', typeName: 'intake_form' });
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA_WITH_FIELDS]));
    renderEditor('/records/new', { schemas: { listSchemas }, records: { createRecord } });

    await user.click(await screen.findByLabelText('Record type'));
    await user.click(await screen.findByRole('option', { name: 'Intake' }));

    // Form view is default; the required field gates save.
    const firstName = await screen.findByRole('textbox', { name: /firstName/ });
    expect(screen.getByRole('button', { name: 'Create record' })).toBeDisabled();

    await user.type(firstName, 'Alice');
    await user.click(screen.getByRole('button', { name: 'Create record' }));

    await waitFor(() =>
      expect(createRecord).toHaveBeenCalledWith({
        body: {
          typeName: 'intake_form',
          schemaId: 'schema_abc',
          payload: { firstName: 'Alice' },
        },
      }),
    );
  });

  it('never renders or sends a reserved field even if the schema declares one', async () => {
    // Mirrors a real schema ("convention") that mistakenly declares an
    // `externalId` field: the form must not offer an input for it, and a create
    // must not send it inside the payload (it's a reserved top-level field).
    const user = userEvent.setup();
    const createRecord = vi.fn().mockResolvedValue({ id: 'rec_new', typeName: 'convention' });
    const listSchemas = vi.fn().mockResolvedValue(
      pageOf([
        {
          id: 'schema_conv',
          allowedSurfaces: ['record'], typeName: 'convention',
          displayName: 'Convention',
          fields: [
            { fieldId: 'name', fieldType: 'string', required: true },
            { fieldId: 'externalId', fieldType: 'string' },
          ],
        },
      ]),
    );
    renderEditor('/records/new', { schemas: { listSchemas }, records: { createRecord } });

    await user.click(await screen.findByLabelText('Record type'));
    await user.click(await screen.findByRole('option', { name: 'Convention' }));

    // The reserved field is NOT offered as a form input.
    await screen.findByRole('textbox', { name: /name/ });
    expect(screen.queryByRole('textbox', { name: /externalId/ })).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: /name/ }), 'TEST 1');
    await user.click(screen.getByRole('button', { name: 'Create record' }));

    await waitFor(() =>
      expect(createRecord).toHaveBeenCalledWith({
        body: {
          typeName: 'convention',
          schemaId: 'schema_conv',
          payload: { name: 'TEST 1' },
        },
      }),
    );
  });

  it('toggling to raw shows the JSON reflecting the form edit', async () => {
    const user = userEvent.setup();
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA_WITH_FIELDS]));
    renderEditor('/records/new', { schemas: { listSchemas }, records: { createRecord: vi.fn() } });

    await user.click(await screen.findByLabelText('Record type'));
    await user.click(await screen.findByRole('option', { name: 'Intake' }));
    await user.type(await screen.findByRole('textbox', { name: /firstName/ }), 'Bob');

    await user.click(screen.getByRole('button', { name: 'Raw JSON' }));
    expect(await screen.findByDisplayValue(/"firstName": "Bob"/)).toBeInTheDocument();
  });
});

describe('RecordEditorPage — edit', () => {
  beforeEach(() => mockedClient.mockReset());

  it('updates with the loaded version as expectedVersion, then navigates', async () => {
    const user = userEvent.setup();
    const getRecord = vi.fn().mockResolvedValue({
      id: 'rec_1',
      typeName: 'intake_form',
      schemaId: 'schema_abc',
      version: 3,
      payload: { firstName: 'Alice' },
    });
    const updateRecord = vi
      .fn()
      .mockResolvedValue({ id: 'rec_1', typeName: 'intake_form', version: 4 });
    renderEditor('/records/rec_1/edit', { records: { getRecord, updateRecord } });

    // Editor seeds from the loaded record.
    await screen.findByDisplayValue(/Alice/);

    fireEvent.change(screen.getByLabelText('Payload (JSON)'), {
      target: { value: '{"firstName":"Bob"}' },
    });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(updateRecord).toHaveBeenCalledWith({
        id: 'rec_1',
        body: {
          typeName: 'intake_form',
          schemaId: 'schema_abc',
          payload: { firstName: 'Bob' },
          expectedVersion: 3,
        },
      }),
    );
    expect(await screen.findByText('detail:rec_1')).toBeInTheDocument();
  });

  it('drops a reserved key already in the record payload on update (seed + save strip)', async () => {
    const user = userEvent.setup();
    const getRecord = vi.fn().mockResolvedValue({
      id: 'rec_1',
      typeName: 'intake_form',
      schemaId: 'schema_abc',
      version: 3,
      payload: { name: 'Acme', externalId: 'legacy-in-payload' },
    });
    const updateRecord = vi
      .fn()
      .mockResolvedValue({ id: 'rec_1', typeName: 'intake_form', version: 4 });
    renderEditor('/records/rec_1/edit', { records: { getRecord, updateRecord } });

    // The seeded editor already shows only `name` — the reserved key is dropped.
    await screen.findByDisplayValue(/Acme/);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateRecord).toHaveBeenCalled());
    expect(updateRecord.mock.calls[0]?.[0]?.body?.payload).toEqual({ name: 'Acme' });
  });

  it('on a 409 conflict, overwrite resubmits without expectedVersion', async () => {
    const user = userEvent.setup();
    const getRecord = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'rec_1',
        typeName: 'intake_form',
        schemaId: 'schema_abc',
        version: 3,
        payload: { n: 1 },
      })
      .mockResolvedValue({
        id: 'rec_1',
        typeName: 'intake_form',
        schemaId: 'schema_abc',
        version: 5,
        payload: { n: 2 },
      });
    const updateRecord = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), { statusCode: 409 }))
      .mockResolvedValue({ id: 'rec_1', typeName: 'intake_form', version: 6 });
    renderEditor('/records/rec_1/edit', { records: { getRecord, updateRecord } });

    await screen.findByDisplayValue(/"n": 1/);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    // Conflict surfaces with the refetched latest version.
    expect(await screen.findByText(/changed since you opened it/i)).toBeInTheDocument();
    await screen.findByText(/now version 5/i);

    await user.click(screen.getByRole('button', { name: 'Overwrite anyway' }));

    await waitFor(() => expect(updateRecord).toHaveBeenCalledTimes(2));
    expect(updateRecord.mock.calls[1]?.[0]?.body?.expectedVersion).toBeUndefined();
    expect(await screen.findByText('detail:rec_1')).toBeInTheDocument();
  });

  it('on a 409 conflict, reload-latest reseeds the editor from the server', async () => {
    const user = userEvent.setup();
    const getRecord = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'rec_1',
        typeName: 'intake_form',
        schemaId: 'schema_abc',
        version: 3,
        payload: { n: 1 },
      })
      .mockResolvedValue({
        id: 'rec_1',
        typeName: 'intake_form',
        schemaId: 'schema_abc',
        version: 5,
        payload: { n: 99 },
      });
    const updateRecord = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('conflict'), { statusCode: 409 }));
    renderEditor('/records/rec_1/edit', { records: { getRecord, updateRecord } });

    await screen.findByDisplayValue(/"n": 1/);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/changed since you opened it/i);

    await user.click(screen.getByRole('button', { name: 'Reload latest' }));

    // Editor now shows the server's latest payload, conflict dismissed.
    expect(await screen.findByDisplayValue(/"n": 99/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText(/changed since you opened it/i)).not.toBeInTheDocument(),
    );
  });
});
