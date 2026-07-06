// ---------------------------------------------------------------------------
// RecordEditorPage — the raw-JSON record editor (write paths).
//
// One component, two modes derived from the route:
//   - CREATE  (`/records/new`)         — pick a schema (type), author a JSON
//                                         payload, optionally set an externalId.
//   - EDIT    (`/records/:recordId/edit`) — load the record, edit its payload;
//                                         type/schema/externalId are immutable.
//
// "Raw mode" is the always-available escape hatch: a plain JSON editor over the
// full record body, validated against its schema server-side on save. The
// schema-driven typed form view layers on top of this in a later
// step and stays in sync with it.
//
// Optimistic concurrency: on EDIT we send the `version` we loaded as
// `expectedVersion`. If the record moved on, the API rejects with 409
// VERSION_CONFLICT and we surface a reload-or-overwrite choice rather than
// silently clobbering the concurrent change.
//
// Everything is scoped to the active (tenant, context) by the bearer token;
// after a successful write we invalidate the affected dataQueryKeys so the
// list + detail refetch. Renders inside RequireContext, so the active context
// is resolved.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import ArrowBack from '@mui/icons-material/ArrowBack';
import { FormattedMessage, useIntl } from 'react-intl';
import { LoadingBlock, SubmitButton } from '@vectros-ai/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveContextId, useActiveTenantId } from '../../auth';
import { vectrosApiClient } from '../../api/vectrosApi';
import type { RecordResponse, SchemaResponse, Vectros } from '../../api/vectrosApi';
import { listAllSchemas } from '../../lib/listAllSchemas';
import { schemasForSurface } from '../../lib/schemaSurfaces';
import { dataQueryKeys } from '../../lib/dataQueryKeys';
import { formatRecordPayload, isVersionConflict, parseRecordPayload } from '../../lib/recordEditor';
import {
  coerceFieldValue,
  isFormEditable,
  isReservedPayloadKey,
  stripReservedPayloadKeys,
  validateFields,
  withField,
} from '../../lib/recordForm';
import { RecordFormFields } from '../../components/RecordFormFields';
import { ApiErrorAlert } from '../../components/ApiErrorAlert';

/** A schema usable as a create target: id + typeName are present. */
type CreatableSchema = SchemaResponse & { readonly id: string; readonly typeName: string };

export function RecordEditorPage(): React.JSX.Element {
  const tenant = useActiveTenantId();
  const context = useActiveContextId();
  const intl = useIntl();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { recordId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const mode: 'create' | 'edit' = recordId === '' ? 'create' : 'edit';
  // CREATE deep-link: `/records/new?type=<typeName>` pre-selects that type (the
  // "New record" button on the list passes the type the user was viewing).
  const requestedType = searchParams.get('type');

  // Editor state. payloadText is the source of truth for the JSON body;
  // baseVersion is the optimistic-concurrency token we loaded (edit only).
  const [payloadText, setPayloadText] = useState('{}');
  const [baseVersion, setBaseVersion] = useState<number | undefined>(undefined);
  const [seeded, setSeeded] = useState(false);
  const [selectedSchemaId, setSelectedSchemaId] = useState('');
  const [externalId, setExternalId] = useState('');
  const [conflict, setConflict] = useState(false);
  const [viewMode, setViewMode] = useState<'form' | 'raw'>('form');

  // CREATE: the context's RECORD-surface schemas are the selectable record
  // types — a document-only schema must not be offered as a create target
  // (the create would be rejected).
  const schemasQuery = useQuery({
    queryKey: dataQueryKeys.schemas(tenant, context),
    queryFn: () => listAllSchemas(tenant, context),
    enabled: mode === 'create',
  });
  const creatableSchemas: ReadonlyArray<CreatableSchema> = schemasForSurface(
    schemasQuery.data ?? [],
    'record',
  ).filter((s): s is CreatableSchema => typeof s.id === 'string');

  // EDIT: load the record to seed the editor + capture its version.
  const recordQuery = useQuery({
    queryKey: dataQueryKeys.record(tenant, context, recordId),
    queryFn: () => vectrosApiClient(tenant, context).records.getRecord({ id: recordId }),
    enabled: mode === 'edit',
  });

  // The schema whose fields drive the form view: the create-picker's selection,
  // or (on edit) the record's own schema, fetched by id.
  const editSchemaId = recordQuery.data?.schemaId;
  const schemaQuery = useQuery({
    queryKey: dataQueryKeys.schema(tenant, context, editSchemaId ?? ''),
    queryFn: () => vectrosApiClient(tenant, context).schemas.getSchema({ id: editSchemaId ?? '' }),
    enabled: mode === 'edit' && typeof editSchemaId === 'string' && editSchemaId !== '',
  });
  const activeSchema: SchemaResponse | undefined =
    mode === 'create' ? creatableSchemas.find((s) => s.id === selectedSchemaId) : schemaQuery.data;
  // Reserved identifier fields (externalId / ownership ids) are top-level record
  // fields, never payload entries — drop them so the form neither renders an
  // input for them nor writes them into the body the API would reject.
  const schemaFields: ReadonlyArray<Vectros.FieldDef> = (activeSchema?.fields ?? []).filter(
    (f) => !isReservedPayloadKey(f.fieldId),
  );
  const hasFormFields = schemaFields.some(isFormEditable);

  // Seed the editor from the loaded record exactly once (not on every refetch,
  // so a background refetch never clobbers in-progress edits). Strip reserved
  // identifier keys defensively, in case an older write stored one in-payload.
  useEffect(() => {
    if (mode === 'edit' && recordQuery.data && !seeded) {
      setPayloadText(formatRecordPayload(stripReservedPayloadKeys(recordQuery.data.payload ?? {})));
      setBaseVersion(recordQuery.data.version);
      setSeeded(true);
    }
  }, [mode, recordQuery.data, seeded]);

  // CREATE: default the schema picker to the requested `?type=` once schemas
  // load (only if the user hasn't already chosen one), so "New record" from a
  // type-filtered list lands pre-set to that type.
  useEffect(() => {
    if (mode !== 'create' || selectedSchemaId !== '' || !requestedType) return;
    const match = creatableSchemas.find((s) => s.typeName === requestedType);
    if (match) setSelectedSchemaId(match.id);
  }, [mode, selectedSchemaId, requestedType, creatableSchemas]);

  const parsed = parseRecordPayload(payloadText);

  // Form view is a typed projection of the parsed payload — available only when
  // a schema with editable fields applies AND the raw JSON currently parses.
  const formAvailable = hasFormFields && parsed.ok;
  const effectiveView: 'form' | 'raw' = formAvailable && viewMode === 'form' ? 'form' : 'raw';
  const fieldErrors = activeSchema && parsed.ok ? validateFields(schemaFields, parsed.value) : {};
  const formInvalid = effectiveView === 'form' && Object.keys(fieldErrors).length > 0;

  // A form edit writes the coerced value back through the raw source of truth.
  const handleFieldChange = (field: Vectros.FieldDef, input: string | boolean): void => {
    if (!parsed.ok) return; // unreachable in form view (raw is valid there)
    const next = withField(parsed.value, field.fieldId, coerceFieldValue(field, input));
    setPayloadText(JSON.stringify(next, null, 2));
  };

  const saveMutation = useMutation({
    mutationFn: async (opts: { readonly overwrite: boolean }): Promise<RecordResponse> => {
      if (!parsed.ok) {
        // Unreachable: Save is disabled while the payload is invalid. Guarded so
        // the type narrows and a programming error surfaces loudly if it isn't.
        throw new Error('payload not parseable');
      }
      const client = vectrosApiClient(tenant, context);
      // Reserved identifier keys are top-level fields, never payload entries —
      // the write API rejects a payload that carries one. externalId is sent via
      // its own top-level field on create.
      const payload = stripReservedPayloadKeys(parsed.value);

      if (mode === 'create') {
        const schema = creatableSchemas.find((s) => s.id === selectedSchemaId);
        if (!schema) throw new Error('no schema selected');
        const trimmedExternalId = externalId.trim();
        return client.records.createRecord({
          body: {
            typeName: schema.typeName,
            schemaId: schema.id,
            payload,
            ...(trimmedExternalId === '' ? {} : { externalId: trimmedExternalId }),
          },
        });
      }

      // EDIT: send expectedVersion unless the user chose to overwrite (which
      // drops the guard → last-write-wins).
      const record = recordQuery.data;
      return client.records.updateRecord({
        id: recordId,
        body: {
          typeName: record?.typeName ?? '',
          schemaId: record?.schemaId ?? '',
          payload,
          ...(opts.overwrite || baseVersion === undefined ? {} : { expectedVersion: baseVersion }),
        },
      });
    },
    onSuccess: (saved) => {
      const typeName =
        mode === 'create'
          ? creatableSchemas.find((s) => s.id === selectedSchemaId)?.typeName
          : (recordQuery.data?.typeName ?? saved.typeName);
      if (typeName) {
        void queryClient.invalidateQueries({
          queryKey: dataQueryKeys.records(tenant, context, typeName),
        });
      }
      if (saved.id) {
        void queryClient.invalidateQueries({ queryKey: dataQueryKeys.record(tenant, context, saved.id) });
        navigate(`/records/${encodeURIComponent(saved.id)}`);
      } else {
        navigate('/records');
      }
    },
    onError: (err) => {
      if (mode === 'edit' && isVersionConflict(err)) {
        setConflict(true);
        // Refresh the displayed "latest version" without reseeding the editor
        // (the user may still want to overwrite their edits).
        void recordQuery.refetch();
      }
    },
  });

  // Conflict recovery — discard local edits and reseed from the server's latest.
  const handleReloadLatest = async (): Promise<void> => {
    const result = await recordQuery.refetch();
    const latest = result.data;
    if (latest) {
      // Strip reserved keys here too (matches the initial seed) so a conflict
      // reload of a legacy in-payload write doesn't re-surface them.
      setPayloadText(formatRecordPayload(stripReservedPayloadKeys(latest.payload ?? {})));
      setBaseVersion(latest.version);
    }
    setConflict(false);
    saveMutation.reset();
  };

  // Cancel returns to the record's detail (edit) or the list (create). On create
  // carry the type back so the list lands on the same type the user came from.
  const cancelTo =
    mode === 'edit'
      ? `/records/${encodeURIComponent(recordId)}`
      : requestedType
        ? `/records?type=${encodeURIComponent(requestedType)}`
        : '/records';
  const backButton = (
    <Button
      component={RouterLink}
      to={cancelTo}
      startIcon={<ArrowBack />}
      size="small"
      sx={{ alignSelf: 'flex-start' }}
    >
      <FormattedMessage id="recordEditor.cancel" />
    </Button>
  );

  // EDIT load states.
  if (mode === 'edit' && recordQuery.isPending) {
    return (
      <Stack spacing={3}>
        {backButton}
        <LoadingBlock label={intl.formatMessage({ id: 'recordEditor.loading' })} />
      </Stack>
    );
  }
  if (mode === 'edit' && recordQuery.isError) {
    return (
      <Stack spacing={3}>
        {backButton}
        <ApiErrorAlert error={recordQuery.error}>
          <FormattedMessage id="recordEditor.loadError" />
        </ApiErrorAlert>
      </Stack>
    );
  }

  // CREATE: surface the schema-picker query's loading + error states so a
  // failed schemas load isn't a silently-empty, unexplained disabled Select.
  if (mode === 'create' && schemasQuery.isPending) {
    return (
      <Stack spacing={3}>
        {backButton}
        <LoadingBlock label={intl.formatMessage({ id: 'recordEditor.loadingSchemas' })} />
      </Stack>
    );
  }
  if (mode === 'create' && schemasQuery.isError) {
    return (
      <Stack spacing={3}>
        {backButton}
        <ApiErrorAlert error={schemasQuery.error}>
          <FormattedMessage id="recordEditor.schemasError" />
        </ApiErrorAlert>
      </Stack>
    );
  }

  const canSave =
    parsed.ok &&
    !saveMutation.isPending &&
    !formInvalid &&
    (mode === 'edit' || selectedSchemaId !== '');

  return (
    <Stack spacing={3}>
      {backButton}

      <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
        <FormattedMessage
          id={mode === 'create' ? 'recordEditor.createTitle' : 'recordEditor.editTitle'}
        />
      </Typography>

      {mode === 'create' && schemasQuery.isSuccess && creatableSchemas.length === 0 && (
        <Alert severity="info">
          <FormattedMessage id="recordEditor.noSchemas" />
        </Alert>
      )}

      {conflict && (
        <Alert
          severity="warning"
          role="alert"
          action={
            <Stack direction="row" spacing={1}>
              <Button color="inherit" size="small" onClick={() => void handleReloadLatest()}>
                <FormattedMessage id="recordEditor.reloadLatest" />
              </Button>
              <Button
                color="inherit"
                size="small"
                onClick={() => saveMutation.mutate({ overwrite: true })}
              >
                <FormattedMessage id="recordEditor.overwrite" />
              </Button>
            </Stack>
          }
        >
          <AlertTitle>
            <FormattedMessage id="recordEditor.conflictTitle" />
          </AlertTitle>
          <FormattedMessage
            id="recordEditor.conflictBody"
            values={{ version: recordQuery.data?.version ?? '?' }}
          />
        </Alert>
      )}

      {saveMutation.isError && !conflict && (
        <ApiErrorAlert error={saveMutation.error}>
          <FormattedMessage id="recordEditor.saveError" />
        </ApiErrorAlert>
      )}

      <Card>
        <CardContent>
          <Stack spacing={3}>
            {mode === 'create' ? (
              <>
                <FormControl
                  size="small"
                  sx={{ maxWidth: 480 }}
                  disabled={creatableSchemas.length === 0}
                >
                  <InputLabel id="record-editor-schema-label">
                    <FormattedMessage id="recordEditor.schemaLabel" />
                  </InputLabel>
                  <Select
                    labelId="record-editor-schema-label"
                    label={intl.formatMessage({ id: 'recordEditor.schemaLabel' })}
                    value={selectedSchemaId}
                    onChange={(e: SelectChangeEvent) => setSelectedSchemaId(e.target.value)}
                  >
                    {creatableSchemas.map((s) => (
                      <MenuItem key={s.id} value={s.id}>
                        {s.displayName && s.displayName.length > 0 ? s.displayName : s.typeName}
                      </MenuItem>
                    ))}
                  </Select>
                  <FormHelperText>
                    <FormattedMessage id="recordEditor.schemaHelp" />
                  </FormHelperText>
                </FormControl>

                <TextField
                  label={intl.formatMessage({ id: 'recordEditor.externalIdLabel' })}
                  helperText={intl.formatMessage({ id: 'recordEditor.externalIdHelp' })}
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                  size="small"
                  sx={{ maxWidth: 480 }}
                  slotProps={{ htmlInput: { maxLength: 256 } }}
                />
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                <FormattedMessage
                  id="recordEditor.editMeta"
                  values={{
                    type: recordQuery.data?.typeName ?? '—',
                    version: baseVersion ?? '—',
                  }}
                />
              </Typography>
            )}

            {hasFormFields && (
              <ToggleButtonGroup
                value={effectiveView}
                exclusive
                size="small"
                onChange={(_e, next: 'form' | 'raw' | null) => {
                  if (next !== null) setViewMode(next);
                }}
                aria-label={intl.formatMessage({ id: 'recordEditor.viewToggleLabel' })}
              >
                <ToggleButton value="form" disabled={!parsed.ok}>
                  <FormattedMessage id="recordEditor.viewForm" />
                </ToggleButton>
                <ToggleButton value="raw">
                  <FormattedMessage id="recordEditor.viewRaw" />
                </ToggleButton>
              </ToggleButtonGroup>
            )}

            {effectiveView === 'form' && parsed.ok ? (
              <RecordFormFields
                fields={schemaFields}
                value={parsed.value}
                errors={fieldErrors}
                renderHints={activeSchema?.renderHints}
                onChange={handleFieldChange}
              />
            ) : (
              <TextField
                label={intl.formatMessage({ id: 'recordEditor.payloadLabel' })}
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
                multiline
                minRows={10}
                error={!parsed.ok}
                helperText={
                  parsed.ok
                    ? intl.formatMessage({ id: 'recordEditor.payloadHelp' })
                    : parsed.kind === 'syntax'
                      ? intl.formatMessage(
                          { id: 'recordEditor.errorSyntax' },
                          { detail: parsed.detail },
                        )
                      : intl.formatMessage({ id: 'recordEditor.errorNotObject' })
                }
                slotProps={{
                  htmlInput: { style: { fontFamily: 'monospace', fontSize: '0.8125rem' } },
                }}
                spellCheck={false}
              />
            )}

            <Box sx={{ display: 'flex', gap: 1 }}>
              <SubmitButton
                variant="contained"
                disabled={!canSave}
                onClick={() => saveMutation.mutate({ overwrite: false })}
                pending={saveMutation.isPending}
              >
                <FormattedMessage
                  id={mode === 'create' ? 'recordEditor.create' : 'recordEditor.save'}
                />
              </SubmitButton>
              <Button component={RouterLink} to={cancelTo}>
                <FormattedMessage id="recordEditor.cancel" />
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
