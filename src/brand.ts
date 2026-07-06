// ---------------------------------------------------------------------------
// Brand configuration — single source of truth for product name, colors,
// support contacts, and links.
//
// Forks of this reference app re-brand by editing THIS FILE ONLY.
// No JSX in `src/` should hardcode "Vectros", a color hex, or a support
// email. If you see one elsewhere, that's a bug — move it here.
//
// Typography choices live in src/theme.ts (which consumes this module).
// ---------------------------------------------------------------------------

export interface BrandConfig {
  /** Short product name used in titles, app bar, footer. */
  readonly productName: string;
  /**
   * Logo image URL shown in the sidebar header. A light-on-dark mark (the nav
   * rail is dark). Served from `public/`; a fork drops in its own asset and
   * points this at it. Omit to fall back to the product name as text.
   */
  readonly logo: string;
  /** App sub-label shown next to the wordmark — names this app behind the shared
   *  Vectros brand (e.g. "Data"), so users know which surface they're on. */
  readonly appQualifier: string;
  /** Full company/legal name for legal copy. */
  readonly legalName: string;
  /** Support contact for the in-app "stuck?" recovery links. */
  readonly supportEmail: string;
  /**
   * The companion admin app's URL. app.vectros.ai is the data plane — it does
   * NOT manage identity, account, security, or context provisioning (those are
   * control-plane concerns owned by the admin app). The few places that need to
   * hand the user off for account management deep-link here.
   */
  readonly adminAppUrl: string;
  /** Privacy policy URL — surfaced in legal copy. */
  readonly privacyUrl: string;
  /** Terms of service URL — surfaced in legal copy. */
  readonly termsUrl: string;
  /** Brand colors. Used to derive the MUI theme in src/theme.ts. */
  readonly colors: {
    /** Primary brand color — used for primary buttons and accent. */
    readonly primary: string;
    /** Page background. */
    readonly background: string;
    /** Card / surface background. */
    readonly surface: string;
    /** Primary text on background/surface. */
    readonly textPrimary: string;
    /** Muted/secondary text. */
    readonly textSecondary: string;
    /** Divider / border. */
    readonly divider: string;
  };
}

export const BRAND: BrandConfig = {
  productName: 'Vectros',
  logo: '/logo.svg',
  appQualifier: 'Data',
  legalName: 'Vectros AI',
  supportEmail: 'support@vectros.ai',
  adminAppUrl: 'https://admin.vectros.ai',
  privacyUrl: 'https://vectros.ai/privacy',
  termsUrl: 'https://vectros.ai/terms',
  colors: {
    primary: '#0F172A',
    background: '#F9FAFB',
    surface: '#FFFFFF',
    textPrimary: '#09090B',
    textSecondary: '#52525B',
    divider: '#E4E4E7',
  },
};
