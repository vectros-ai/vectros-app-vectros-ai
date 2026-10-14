// ---------------------------------------------------------------------------
// inferenceRouting — which model path an inference call takes, as request fields.
//
// With no provider alias the call is served by the platform-hosted models and
// `model` is a registry id. With an alias, the call is routed to a model
// provider your account owner configured: `providerAlias` selects that config
// and `model` (optional) is a model id on the PROVIDER, not a registry id. The
// two ids live in different spaces, so they are held separately and exactly one
// of them is ever sent.
// ---------------------------------------------------------------------------

import type { Vectros } from '../api/vectrosApi';

export interface InferenceRoutingInput {
  /** The alias as typed; surrounding whitespace and invisible characters are ignored. */
  readonly alias: string;
  /** The selected platform registry model id. */
  readonly registryModel: string | undefined;
  /** The model id typed for the provider path. */
  readonly providerModel: string;
}

/**
 * The routing-related fields of a chat / RAG / document-ask request, taken from
 * the SDK's own request type so a rename there fails the typecheck here.
 */
export type InferenceRoutingFields = Pick<Vectros.RagRequest, 'providerAlias' | 'model'>;

// Compile-time guard: the same two fields must exist, with the same types, on
// the other two request types the routing fields are spread into. A rename or a
// type change in the SDK makes `Assert<...>` below fail the typecheck.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type InferenceRoutingFieldsMatchSdk = [
  Assert<Same<Pick<Vectros.ChatRequest, 'providerAlias' | 'model'>, InferenceRoutingFields>>,
  Assert<Same<Pick<Vectros.DocumentAskRequest, 'providerAlias' | 'model'>, InferenceRoutingFields>>,
];

/**
 * Trim a typed value and drop invisible format characters (zero-width space,
 * soft hyphen, direction marks, word joiner): a pasted value can carry them
 * and the API matches the alias exactly.
 */
function clean(value: string): string {
  return value.replace(/\p{Cf}/gu, '').trim();
}

/** The cleaned alias, or `undefined` when the call is not provider-routed. */
export function activeProviderAlias(alias: string): string | undefined {
  const cleaned = clean(alias);
  return cleaned === '' ? undefined : cleaned;
}

/**
 * The request fields for the current routing choice. Provider path:
 * `providerAlias` plus the provider model when one was typed (omitted otherwise,
 * so the provider config's own default applies). Platform path: the registry
 * model only, and never a `providerAlias` key.
 */
export function inferenceRoutingFields(input: InferenceRoutingInput): InferenceRoutingFields {
  const providerAlias = activeProviderAlias(input.alias);
  if (providerAlias !== undefined) {
    const providerModel = clean(input.providerModel);
    return providerModel === '' ? { providerAlias } : { providerAlias, model: providerModel };
  }
  return input.registryModel !== undefined ? { model: input.registryModel } : {};
}
