// ---------------------------------------------------------------------------
// SchemaDetailPage — read-only schema view (path: `/schemas/:schemaId`).
//
// Shows a schema's metadata (type, description, storage profile, version,
// timestamps), its field definitions (type, required, searchable, filterable),
// its lookup fields, and any enabled capabilities. Read-only — schema authoring
// is a control-plane concern. Linked from the schema browser
// (SchemasPage) and from a record's "Schema" field (RecordDetailPage).
//
// Renders inside RequireContext, so the active context is resolved.
// ---------------------------------------------------------------------------

import { Link as RouterLink, useParams } from 'react-router';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ArrowBack from '@mui/icons-material/ArrowBack';
import { FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { ApiErrorAlert, LoadingBlock, MetaList, MetaRow } from '@vectros-ai/react';
import { useQuery } from '@tanstack/react-query';

import { useActiveContextId, useActiveTenantId } from '../../auth';
import { vectrosApiClient } from '../../api/vectrosApi';
import { dataQueryKeys } from '../../lib/dataQueryKeys';
import { lookupFieldLabel } from '../../lib/lookupFieldLabel';

/** A small ✓/— cell for a boolean field attribute. */
function BoolCell({ on }: { readonly on: boolean | undefined }): React.JSX.Element {
  return <>{on ? '✓' : '—'}</>;
}

export function SchemaDetailPage(): React.JSX.Element {
  const tenant = useActiveTenantId();
  const context = useActiveContextId();
  const intl = useIntl();
  const { schemaId = '' } = useParams();

  const schemaQuery = useQuery({
    queryKey: dataQueryKeys.schema(tenant, context, schemaId),
    queryFn: () => vectrosApiClient(tenant, context).schemas.getSchema({ id: schemaId }),
    enabled: schemaId !== '',
  });

  // The lineage base this schema is a customization of, fetched by id
  // for a friendly label — mirrors the record detail page's reference
  // cross-links. Stays unset/undefined when this schema IS the base, or while
  // its own load is still pending.
  const basedOnId = schemaQuery.data?.basedOn;
  const baseSchemaQuery = useQuery({
    queryKey: dataQueryKeys.schema(tenant, context, basedOnId ?? ''),
    queryFn: () => vectrosApiClient(tenant, context).schemas.getSchema({ id: basedOnId ?? '' }),
    enabled: typeof basedOnId === 'string' && basedOnId !== '',
  });

  const backButton = (
    <Button
      component={RouterLink}
      to="/schemas"
      startIcon={<ArrowBack />}
      size="small"
      sx={{ alignSelf: 'flex-start' }}
    >
      <FormattedMessage id="schemaDetail.back" />
    </Button>
  );

  if (schemaQuery.isPending) {
    return (
      <Stack spacing={3}>
        {backButton}
        <LoadingBlock label={intl.formatMessage({ id: 'schemaDetail.loading' })} />
      </Stack>
    );
  }

  if (schemaQuery.isError) {
    return (
      <Stack spacing={3}>
        {backButton}
        <ApiErrorAlert error={schemaQuery.error}>
          <FormattedMessage id="schemaDetail.error" />
        </ApiErrorAlert>
      </Stack>
    );
  }

  const schema = schemaQuery.data;
  const fields = schema.fields ?? [];
  const lookupFields = schema.lookupFields ?? [];
  // Capabilities is a flag map; surface only the enabled ones as chips.
  const enabledCapabilities = Object.entries(schema.capabilities ?? {})
    .filter(([, on]) => on)
    .map(([name]) => name);

  return (
    <Stack spacing={3}>
      {backButton}

      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
          {schema.typeName ?? schema.id ?? intl.formatMessage({ id: 'schemaDetail.untitled' })}
        </Typography>
        {schema.displayName && schema.displayName.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {schema.displayName}
          </Typography>
        )}
      </Box>

      {/* Metadata */}
      <Card>
        <CardContent>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
            <FormattedMessage id="schemaDetail.metaTitle" />
          </Typography>
          <MetaList>
            <MetaRow label={intl.formatMessage({ id: 'schemaDetail.fieldDescription' })}>
              <Typography variant="body2">{schema.description ?? '—'}</Typography>
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'schemaDetail.fieldStorage' })}>
              <Typography variant="body2">{schema.storageProfile ?? '—'}</Typography>
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'schemaDetail.fieldVersion' })}>
              <Typography variant="body2">{schema.schemaVersion ?? '—'}</Typography>
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'schemaDetail.fieldLineage' })}>
              {schema.basedOn ? (
                <Link component={RouterLink} to={`/schemas/${encodeURIComponent(schema.basedOn)}`}>
                  <FormattedMessage
                    id="schemaDetail.lineageVariantOf"
                    values={{
                      name:
                        baseSchemaQuery.data?.displayName && baseSchemaQuery.data.displayName.length > 0
                          ? baseSchemaQuery.data.displayName
                          : (baseSchemaQuery.data?.typeName ?? schema.basedOn),
                    }}
                  />
                </Link>
              ) : (
                <Typography variant="body2">
                  <FormattedMessage id="schemaDetail.lineageBase" />
                </Typography>
              )}
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'schemaDetail.fieldActive' })}>
              <Chip
                size="small"
                variant="outlined"
                color={schema.active === false ? 'default' : 'success'}
                label={intl.formatMessage({
                  id: schema.active === false ? 'schemas.inactive' : 'schemas.active',
                })}
              />
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'schemaDetail.fieldCreated' })}>
              <Typography variant="body2">
                {schema.createdAt ? (
                  <FormattedDate
                    value={schema.createdAt}
                    year="numeric"
                    month="short"
                    day="numeric"
                    hour="2-digit"
                    minute="2-digit"
                  />
                ) : (
                  '—'
                )}
              </Typography>
            </MetaRow>
            <MetaRow label={intl.formatMessage({ id: 'schemaDetail.fieldUpdated' })}>
              <Typography variant="body2">
                {schema.updatedAt ? (
                  <FormattedDate
                    value={schema.updatedAt}
                    year="numeric"
                    month="short"
                    day="numeric"
                    hour="2-digit"
                    minute="2-digit"
                  />
                ) : (
                  '—'
                )}
              </Typography>
            </MetaRow>
            {enabledCapabilities.length > 0 && (
              <MetaRow label={intl.formatMessage({ id: 'schemaDetail.fieldCapabilities' })}>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                  {enabledCapabilities.map((cap) => (
                    <Chip key={cap} size="small" label={cap} />
                  ))}
                </Stack>
              </MetaRow>
            )}
          </MetaList>
        </CardContent>
      </Card>

      {/* Field definitions */}
      <Card>
        <CardContent>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
            <FormattedMessage id="schemaDetail.fieldsTitle" />
          </Typography>
          {fields.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              <FormattedMessage id="schemaDetail.noFields" />
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small" aria-label={intl.formatMessage({ id: 'schemaDetail.fieldsTitle' })}>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <FormattedMessage id="schemaDetail.colField" />
                    </TableCell>
                    <TableCell>
                      <FormattedMessage id="schemaDetail.colFieldType" />
                    </TableCell>
                    <TableCell align="center">
                      <FormattedMessage id="schemaDetail.colRequired" />
                    </TableCell>
                    <TableCell align="center">
                      <FormattedMessage id="schemaDetail.colSearchable" />
                    </TableCell>
                    <TableCell align="center">
                      <FormattedMessage id="schemaDetail.colFilterable" />
                    </TableCell>
                    <TableCell>
                      <FormattedMessage id="schemaDetail.colFieldDescription" />
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {fields.map((f) => (
                    <TableRow key={f.fieldId} hover>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{f.fieldId}</TableCell>
                      <TableCell>{f.fieldType}</TableCell>
                      <TableCell align="center">
                        <BoolCell on={f.required} />
                      </TableCell>
                      <TableCell align="center">
                        <BoolCell on={f.searchable} />
                      </TableCell>
                      <TableCell align="center">
                        <BoolCell on={f.filterable} />
                      </TableCell>
                      <TableCell>{f.description ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* Lookup fields — only shown when the schema declares any. */}
      {lookupFields.length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
              <FormattedMessage id="schemaDetail.lookupsTitle" />
            </Typography>
            <TableContainer>
              <Table size="small" aria-label={intl.formatMessage({ id: 'schemaDetail.lookupsTitle' })}>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <FormattedMessage id="schemaDetail.colLookupField" />
                    </TableCell>
                    <TableCell align="center">
                      <FormattedMessage id="schemaDetail.colUnique" />
                    </TableCell>
                    <TableCell align="center">
                      <FormattedMessage id="schemaDetail.colRange" />
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lookupFields.map((l) => {
                    // A composite lookup (0.38.0) has no `fieldName` — only an
                    // ordered `fieldNames[]` of its legs. Render its declared
                    // identity (`status,area`, the documented `field=` wire
                    // spelling) rather than `undefined`. `lookupFieldLabel`
                    // falls back to `''` only for a shape the API doesn't
                    // produce (neither field set) — skip rendering it rather
                    // than emit a blank row that would collide on `key=''`
                    // with a sibling in the same, already-impossible case.
                    const label = lookupFieldLabel(l);
                    if (label === '') return null;
                    return (
                      <TableRow key={label} hover>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{label}</TableCell>
                        <TableCell align="center">
                          <BoolCell on={l.unique} />
                        </TableCell>
                        {/* Range-enabled lookups also support ordered range + prefix
                            queries (not just exact match). */}
                        <TableCell align="center">
                          <BoolCell on={l.rangeEnabled} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}
