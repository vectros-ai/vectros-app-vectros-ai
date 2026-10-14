import { describe, expect, it } from 'vitest';

import { activeProviderAlias, inferenceRoutingFields } from './inferenceRouting';

describe('activeProviderAlias', () => {
  it('is undefined for blank or whitespace-only input', () => {
    expect(activeProviderAlias('')).toBeUndefined();
    expect(activeProviderAlias('   ')).toBeUndefined();
  });

  it('trims a typed alias', () => {
    expect(activeProviderAlias('  my-provider ')).toBe('my-provider');
  });
});

describe('inferenceRoutingFields', () => {
  it('sends only the registry model, and no providerAlias key, when no alias is set', () => {
    const fields = inferenceRoutingFields({
      alias: '',
      registryModel: 'haiku',
      providerModel: 'ignored-provider-model',
    });
    expect(fields).toEqual({ model: 'haiku' });
    expect(fields).not.toHaveProperty('providerAlias');
  });

  it('sends nothing when no alias is set and no registry model is selected yet', () => {
    expect(
      inferenceRoutingFields({ alias: '', registryModel: undefined, providerModel: '' }),
    ).toEqual({});
  });

  it('sends the alias and the provider model, never the registry model, when an alias is set', () => {
    expect(
      inferenceRoutingFields({
        alias: 'my-provider',
        registryModel: 'haiku',
        providerModel: 'provider-model-1',
      }),
    ).toEqual({ providerAlias: 'my-provider', model: 'provider-model-1' });
  });

  it('omits model when an alias is set and no provider model was typed', () => {
    const fields = inferenceRoutingFields({
      alias: 'my-provider',
      registryModel: 'haiku',
      providerModel: '  ',
    });
    expect(fields).toEqual({ providerAlias: 'my-provider' });
    expect(fields).not.toHaveProperty('model');
  });

  it('treats a whitespace-only alias as no alias', () => {
    expect(
      inferenceRoutingFields({ alias: '  ', registryModel: 'haiku', providerModel: 'x' }),
    ).toEqual({ model: 'haiku' });
  });
});

describe('trimming and invisible characters', () => {
  it('trims the alias and the provider model in the request', () => {
    expect(
      inferenceRoutingFields({
        alias: '  my-provider 	',
        registryModel: 'haiku',
        providerModel: '  provider-model-1 ',
      }),
    ).toEqual({ providerAlias: 'my-provider', model: 'provider-model-1' });
  });

  it('drops zero-width and other invisible format characters pasted into either value', () => {
    // U+200B zero-width space, U+00AD soft hyphen, U+2060 word joiner, U+200E left-to-right mark.
    const alias = '\u200Bmy\u00AD-prov\u2060ider\u200E';
    const model = 'pro\u200Bvider-model-1';
    expect(activeProviderAlias(alias)).toBe('my-provider');
    expect(inferenceRoutingFields({ alias, registryModel: 'haiku', providerModel: model })).toEqual(
      {
        providerAlias: 'my-provider',
        model: 'provider-model-1',
      },
    );
  });

  it('treats an alias made only of invisible characters as no alias', () => {
    expect(activeProviderAlias('\u200B\u2060 ')).toBeUndefined();
    expect(
      inferenceRoutingFields({ alias: '\u200B', registryModel: 'haiku', providerModel: 'x' }),
    ).toEqual({ model: 'haiku' });
  });

  it('keeps a non-blank alias outside the documented format as typed (legacy aliases still work)', () => {
    expect(activeProviderAlias('Legacy.Alias')).toBe('Legacy.Alias');
  });
});
