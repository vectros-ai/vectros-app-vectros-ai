// ---------------------------------------------------------------------------
// SchemasPage — the schema browser (path: `/schemas`).
//
// Schemas define record shape and drive the record editor's form view. Per the
// resolved scope decision, schema *authoring* lives in admin-app /
// CLI / blueprints — app.vectros.ai is a read-only schema CONSUMER. This page
// lists the active context's schemas and links each to its detail (fields,
// lookups, capabilities); there is intentionally no create/edit/delete UI.
//
// Scoped to the active (tenant, context) by the bearer token; the query keys on
// `context` so a context switch refetches cleanly. Renders inside RequireContext,
// so useActiveContextId() is safe here.
// ---------------------------------------------------------------------------

import { Link as RouterLink } from 'react-router';
import {
  Alert,
  Chip,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { LoadingBlock } from '@vectros-ai/react';
import { useQuery } from '@tanstack/react-query';

import { useActiveContextId, useActiveTenantId } from '../../auth';
import type { SchemaResponse } from '../../api/vectrosApi';
import { listAllSchemas } from '../../lib/listAllSchemas';
import { dataQueryKeys } from '../../lib/dataQueryKeys';
import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { PageHeader } from '../../components/PageHeader';

/** Count of field definitions on a schema (0 when none declared). */
function fieldCount(schema: SchemaResponse): number {
  return schema.fields?.length ?? 0;
}

export function SchemasPage(): React.JSX.Element {
  const tenant = useActiveTenantId();
  const context = useActiveContextId();
  const intl = useIntl();

  const schemasQuery = useQuery({
    queryKey: dataQueryKeys.schemas(tenant, context),
    queryFn: () => listAllSchemas(tenant, context),
  });

  const schemas: ReadonlyArray<SchemaResponse> = schemasQuery.data ?? [];

  return (
    <Stack spacing={4}>
      <PageHeader
        title={<FormattedMessage id="schemas.title" />}
        subtitle={<FormattedMessage id="schemas.subtitle" />}
      />

      {schemasQuery.isPending ? (
        <LoadingBlock label={intl.formatMessage({ id: 'schemas.loading' })} />
      ) : schemasQuery.isError ? (
        <ApiErrorAlert error={schemasQuery.error}>
          <FormattedMessage id="schemas.error" />
        </ApiErrorAlert>
      ) : schemas.length === 0 ? (
        <Alert severity="info">
          <FormattedMessage id="schemas.empty" />
        </Alert>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small" aria-label={intl.formatMessage({ id: 'schemas.tableLabel' })}>
            <TableHead>
              <TableRow>
                <TableCell>
                  <FormattedMessage id="schemas.colType" />
                </TableCell>
                <TableCell>
                  <FormattedMessage id="schemas.colName" />
                </TableCell>
                <TableCell align="right">
                  <FormattedMessage id="schemas.colFields" />
                </TableCell>
                <TableCell align="right">
                  <FormattedMessage id="schemas.colVersion" />
                </TableCell>
                <TableCell>
                  <FormattedMessage id="schemas.colActive" />
                </TableCell>
                <TableCell>
                  <FormattedMessage id="schemas.colUpdated" />
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {schemas.map((s) => (
                <TableRow key={s.id ?? s.typeName} hover>
                  <TableCell>
                    {s.id ? (
                      <Link
                        component={RouterLink}
                        to={`/schemas/${encodeURIComponent(s.id)}`}
                        sx={{ fontFamily: 'monospace' }}
                      >
                        {s.typeName ?? s.id}
                      </Link>
                    ) : (
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {s.typeName ?? '—'}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{s.displayName && s.displayName.length > 0 ? s.displayName : '—'}</TableCell>
                  <TableCell align="right">{fieldCount(s)}</TableCell>
                  <TableCell align="right">{s.schemaVersion ?? '—'}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={s.active === false ? 'default' : 'success'}
                      label={intl.formatMessage({
                        id: s.active === false ? 'schemas.inactive' : 'schemas.active',
                      })}
                    />
                  </TableCell>
                  <TableCell>
                    {s.updatedAt ? (
                      <FormattedDate
                        value={s.updatedAt}
                        year="numeric"
                        month="short"
                        day="numeric"
                        hour="2-digit"
                        minute="2-digit"
                      />
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}
