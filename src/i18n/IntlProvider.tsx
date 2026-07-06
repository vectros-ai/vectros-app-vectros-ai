// ---------------------------------------------------------------------------
// IntlProvider — app.vectros.ai's i18n entry point.
//
// The locale-detection + react-intl wrapper lives in @vectros-ai/react
// (catalog-agnostic). This thin wrapper supplies THIS app's English catalog and
// keeps the same `<IntlProvider>` import surface for the app + its tests, so
// call sites don't change. Adding a locale: import the JSON and add an entry to
// MESSAGES_BY_LOCALE.
//
// NOTE: the catalog must define EVERY key the @vectros-ai/react components use
// (layout.*, password.*), not just this app's own (login.*, home.*, account.*).
// Shared components resolve their message ids against THIS catalog.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { IntlProvider as VectrosIntlProvider, baseMessagesEn } from '@vectros-ai/react';
import type { MessagesByLocale } from '@vectros-ai/react';

import messagesEn from './messages.en.json';

// Re-export so existing call sites keep importing the locale constant from the
// app's i18n module rather than reaching into the library.
export { I18N_DEFAULT_LOCALE } from '@vectros-ai/react';

// Merge the package's component-string defaults (AppLayout chrome, PasswordField,
// …) UNDER this app's catalog so we never hand-copy those keys (app keys win on
// collision). This app's catalog only carries its own surfaces.
const MESSAGES_BY_LOCALE: MessagesByLocale = {
  en: { ...baseMessagesEn, ...messagesEn },
};

interface IntlProviderProps {
  readonly children: ReactNode;
  /** Optional locale override — primarily for tests and Storybook. */
  readonly locale?: string;
}

export function IntlProvider({ children, locale }: IntlProviderProps): React.JSX.Element {
  return (
    <VectrosIntlProvider messagesByLocale={MESSAGES_BY_LOCALE} locale={locale}>
      {children}
    </VectrosIntlProvider>
  );
}
