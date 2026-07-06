// ---------------------------------------------------------------------------
// ESLint flat config (ESLint 9+). Mirrors ui/admin-app — one rule set across
// the Vectros reference apps. The chosen rule set:
//
// - typescript-eslint recommended           — catches real TS bugs
// - react-hooks recommended                 — enforces the rules of hooks
// - react-refresh only-export-components    — keeps HMR working
// - jsx-a11y recommended                    — accessibility gates the auth
//                                             pages (WCAG 2.1 AA target)
//
// Notable extras:
// - `no-console` warns. Production code should not ship console.log.
//   Tests and src/test/** are excluded.
// - `no-restricted-globals` blocks `localStorage` / `sessionStorage` /
//   `document.cookie` direct access outside the storage abstraction layer.
//   Defense-in-depth: any place we touch persistent storage should be
//   auditable + centralized (Amplify owns auth-token persistence).
// ---------------------------------------------------------------------------

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      // Browser-storage guardrails. Amplify v6 owns auth-token persistence;
      // any *other* persistent state should go through a small abstraction
      // so we have one place to swap storage strategy if the threat model
      // evolves (e.g. cookieStorage instead of localStorage).
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message:
            'Direct browser-storage access is discouraged. Amplify owns auth-token persistence; add a thin storage abstraction for any other persistent state.',
        },
        {
          name: 'sessionStorage',
          message:
            'Direct browser-storage access is discouraged. Amplify owns auth-token persistence; add a thin storage abstraction for any other persistent state.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='document'][property.name='cookie']",
          message: 'Direct cookie access is discouraged. Auth tokens are owned by Amplify v6.',
        },
      ],
      // The data plane spans a user's live + test tenants, so "the tenant for a
      // data call" is the SELECTED context's tenant — not the global
      // `active_tenant` claim. The app auth barrel (src/auth) re-exports an
      // override of `useActiveTenantId` that resolves from the active context;
      // the package's same-named hook (control-plane semantics) would silently
      // mint against the wrong tenant. Force app code through the barrel.
      // typescript-eslint's variant (not the base rule) so `allowTypeImports`
      // lets tests `import type * as` the package surface for mock typing while
      // still blocking a real value import of the hook.
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@vectros-ai/react',
              importNames: ['useActiveTenantId'],
              allowTypeImports: true,
              message:
                "Import useActiveTenantId from the app auth barrel ('../auth'), which overrides it to return the active context's tenant. The package hook returns the global active_tenant claim and is wrong for the data plane.",
            },
          ],
        },
      ],
    },
  },
  {
    // The auth barrel intentionally `export *`s the package (then overrides
    // useActiveTenantId with an explicit named re-export that takes precedence).
    // The wildcard re-export is the one legitimate reference to the package
    // surface, so the no-restricted-imports guard above doesn't apply here.
    files: ['src/auth/index.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
    },
  },
  {
    // Tests have looser rules — console output, any-types in mocks, etc.
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
