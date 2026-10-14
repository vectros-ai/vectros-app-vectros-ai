// ---------------------------------------------------------------------------
// useInferenceRouting — the model-path state shared by the AI workspace
// surfaces (Ask, Chat, Ask this document): an optional provider alias typed by
// the user, the platform registry model, and the provider-side model id. The
// registry model is seeded from the registry default once it loads. The alias
// is plain screen state: it is never stored.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';

import { explainProviderFailure } from '../lib/inferenceFailure';
import {
  activeProviderAlias,
  inferenceRoutingFields,
  type InferenceRoutingFields,
} from '../lib/inferenceRouting';
import { useInferenceModels } from './useInferenceModels';

export interface InferenceRouting {
  readonly alias: string;
  /** Set the alias; the provider model is dropped when the alias becomes blank or different. */
  readonly setAlias: (alias: string) => void;
  readonly registryModel: string | undefined;
  readonly setRegistryModel: (modelId: string) => void;
  readonly providerModel: string;
  readonly setProviderModel: (modelId: string) => void;
  /** Clear the alias and the provider model (the registry selection is kept). */
  readonly clearProvider: () => void;
  /** True while a (non-blank) alias is set: the call leaves the platform-hosted models. */
  readonly routed: boolean;
  /** The routing fields to spread into the request. */
  readonly requestFields: () => InferenceRoutingFields;
  /**
   * Wrap the SDK call that starts the stream: a refused provider-routed call
   * is rethrown with a readable message. A platform-model call passes through
   * untouched.
   */
  readonly guard: <T>(call: () => PromiseLike<T>) => Promise<T>;
}

export function useInferenceRouting(): InferenceRouting {
  const intl = useIntl();
  const [alias, setAliasText] = useState('');
  const [registryModel, setRegistryModel] = useState<string | undefined>(undefined);
  const [providerModel, setProviderModel] = useState('');
  const modelsQuery = useInferenceModels();

  useEffect(() => {
    const def = modelsQuery.data?.defaultModel;
    if (registryModel === undefined && def) setRegistryModel(def);
  }, [registryModel, modelsQuery.data]);

  const routed = activeProviderAlias(alias) !== undefined;

  // A provider model belongs to one alias: when the alias becomes blank or
  // changes to a different one, the model typed for the old alias is dropped,
  // so it is never sent to the next provider unseen. Edits that leave the
  // cleaned alias the same (stray whitespace) keep it.
  const setAlias = (next: string): void => {
    if (activeProviderAlias(next) !== activeProviderAlias(alias)) setProviderModel('');
    setAliasText(next);
  };

  const clearProvider = useCallback((): void => {
    setAliasText('');
    setProviderModel('');
  }, []);

  const requestFields = (): InferenceRoutingFields =>
    inferenceRoutingFields({ alias, registryModel, providerModel });

  const providerModelTyped =
    inferenceRoutingFields({ alias, registryModel, providerModel }).model !== undefined;

  const guard = useCallback(
    async <T>(call: () => PromiseLike<T>): Promise<T> => {
      if (!routed) return call();
      try {
        return await call();
      } catch (err) {
        throw explainProviderFailure(err, intl, providerModelTyped);
      }
    },
    [routed, intl, providerModelTyped],
  );

  return {
    alias,
    setAlias,
    registryModel,
    setRegistryModel,
    providerModel,
    setProviderModel,
    clearProvider,
    routed,
    requestFields,
    guard,
  };
}
