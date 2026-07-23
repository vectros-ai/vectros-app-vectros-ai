// ---------------------------------------------------------------------------
// ReferenceLink — resolves one reference-field value to its target record and
// renders a cross-link to that record's detail.
//
// A reference stores the target's lookup-field value (e.g. an externalId), not
// the target record's id — so we resolve via
// `lookupRecordsByBody(type, field, value)` to get the id the detail route
// needs. The POST-body form is required, not stylistic: a SENSITIVE lookup
// field cannot be resolved through the GET variant (its value would ride the
// URL query string into access and proxy logs, so the API rejects it with a
// 400). One <ReferenceLink> per value (the
// parent renders an array for cardinality 'many'), so each owns exactly one
// useQuery — rules-of-hooks safe regardless of how many values a field carries.
//
// Resolution is best-effort: while the lookup is pending, or if it returns no
// match (dangling reference, or no read access in this context), the raw value
// is shown as plain monospace text — never a dead link, never a thrown error.
//
// Scale note: this resolves one value per <ReferenceLink> via its own lookup —
// so a `cardinality: many` field with N values fires N parallel lookups (cached
// + 30s-deduped). Fine for a reference app's detail view; a production app at
// scale would want a batch resolve. There's no batch-lookup endpoint on the SDK
// today — tracked as a field-model gap rather than worked around here.
// ---------------------------------------------------------------------------

import { Link as RouterLink } from 'react-router';
import { Link, Tooltip, Typography } from '@mui/material';
import { useIntl } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import { useActiveContextId, useActiveTenantId } from '../auth';
import { vectrosApiClient } from '../api/vectrosApi';
import { dataQueryKeys } from '../lib/dataQueryKeys';

interface ReferenceLinkProps {
  /** The target record type the reference points at. */
  readonly targetTypeName: string;
  /** The target's unique lookup field the value matches against. */
  readonly targetField: string;
  /** The stored reference value (the target's lookup-field value). */
  readonly value: string;
}

export function ReferenceLink({
  targetTypeName,
  targetField,
  value,
}: ReferenceLinkProps): React.JSX.Element {
  const tenant = useActiveTenantId();
  const context = useActiveContextId();
  const intl = useIntl();

  const lookupQuery = useQuery({
    queryKey: dataQueryKeys.recordLookup(tenant, context, targetTypeName, targetField, value),
    // POST-body lookup, not the GET variant: a SENSITIVE lookup field can only be
    // resolved through the body (the GET rejects it with a 400, because the value
    // would otherwise ride the URL query string into access and proxy logs). The
    // GET path left every reference to a sensitive field permanently unresolved.
    queryFn: () =>
      vectrosApiClient(tenant, context).records.lookupRecordsByBody({
        type: targetTypeName,
        field: targetField,
        value,
      }),
    // A reference target rarely changes within a view; avoid refetch churn when
    // the same id is referenced by several fields/records on screen.
    staleTime: 30_000,
  });

  // lookupRecordsByBody returns the `{ data, nextCursor }` page envelope; the
  // first matching record (if any) is the reference target.
  const targetId = lookupQuery.data?.data?.[0]?.id;

  if (targetId !== undefined && targetId !== '') {
    return (
      <Link
        component={RouterLink}
        to={`/records/${encodeURIComponent(targetId)}`}
        variant="body2"
        sx={{ fontFamily: 'monospace' }}
      >
        {value}
      </Link>
    );
  }

  // Pending, errored, or unresolved → show the raw value, never a dead link.
  // When the lookup *settled* with no match, hint why via a tooltip.
  const unresolved = !lookupQuery.isPending && targetId === undefined;
  const text = (
    <Typography component="span" variant="body2" sx={{ fontFamily: 'monospace' }}>
      {value}
    </Typography>
  );
  return unresolved ? (
    <Tooltip title={intl.formatMessage({ id: 'recordDetail.refUnresolved' })}>{text}</Tooltip>
  ) : (
    text
  );
}
