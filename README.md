# app.vectros.ai

The first-party **data-plane** application for the Vectros AI platform, **and** a
canonical reference example for developers building a data app on top of the
[Vectros API](https://docs.vectros.ai).

Fork it. Re-brand it in one file. Point it at your own Cognito pool. Ship.

> **Plane split.** This is the **data plane** — browse, search, author, and
> reason over your records, schemas, folders, and documents, scoped to
> **one AppContext at a time**. Identity, members, scoped keys, roles,
> access-profiles, context provisioning, and account/MFA are **control-plane**
> concerns owned by the
> [admin app](https://github.com/vectros-ai/vectros-admin-app). The two apps
> share an auth stack
> ([`@vectros-ai/react`](https://github.com/vectros-ai/vectros-react)) but
> split cleanly by plane.

---

## What's in the box

| Capability | Implementation note |
|---|---|
| Context switcher | Pick any AppContext you can reach across your live/test environments; every query keys on `(tenant, context)` and a switch re-mints the scoped bearer. |
| Records explorer + editor | Browse by type with schema-driven columns, client-side sort/filter, and server-side lookups (exact / range / prefix on the schema's lookup fields); create/edit in a dual-mode (typed form / raw JSON) editor with optimistic-concurrency conflict handling; archive/restore. |
| Documents | Browse by type and folder, look up by external ID or schema lookup fields, typed metadata, an in-app Markdown viewer (with click-to-view for file-backed documents), signed downloads, create via file upload or text ingest (optional external IDs + update-if-exists), archive/restore, and replace-a-file with automatic re-extraction and re-indexing. |
| Folders | Create/rename/delete with server-side folder-scoped listing and "ask this folder" deep links into the AI workspace. |
| Hybrid search | One ranked result set across records and documents: ranking mode (hybrid/semantic/keyword), content-source, folder, and type filters, offset paging. |
| AI workspace | Multi-turn chat over the context's data, single-shot ask with citations, and per-document Q&A — all streaming, with a model picker. |
| Version history | The audit trail (who changed what, when) on every record and document detail. |
| Cognito authentication | Amplify v6 against the shared DeveloperUserPool, via `@vectros-ai/react`'s `CognitoAuthProvider`. Sign-in + MFA challenge only — account setup lives in the admin app. |
| Protected routing + app shell | `RequireAuth` guard and `AppLayout` (skip-link, responsive drawer, user menu) from `@vectros-ai/react`. |
| Per-(tenant, context) token cache | The `st_*` bearer cache from `@vectros-ai/react`, keyed by `(tenant, context)` — the foundation for the context switcher. |
| Theming + branding | Single-file re-skin via [`src/brand.ts`](src/brand.ts). |
| Strict CSP + security headers | Set at the CloudFront edge in the reference deployment (S3 + CloudFront); bring your own hosting stack and mirror the posture in the Security model below. |

## Stack

Mirrors the [admin app](https://github.com/vectros-ai/vectros-admin-app)
exactly so the reference apps share one set of conventions:

| Layer | Choice |
|---|---|
| Build | [Vite 8](https://vitejs.dev/) |
| Language | TypeScript 5 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| Auth | [aws-amplify](https://docs.amplify.aws/) v6 (Cognito) via `@vectros-ai/react` |
| UI | [MUI v7](https://mui.com/) |
| Server state | [TanStack Query](https://tanstack.com/query) v5 |
| Routing | [react-router](https://reactrouter.com/) v7 |
| Data SDK | [`@vectros-ai/sdk`](https://docs.vectros.ai) (typed, regenerated per backend MR) |
| Tests | [Vitest](https://vitest.dev/) 4 + Testing Library + jsdom |
| Lint | ESLint 9 flat config + `typescript-eslint` + `jsx-a11y` + `react-hooks` |

## Quick start (local development)

Prerequisites: Node 22+ (see [`.nvmrc`](.nvmrc)), npm 10+.

```bash
npm install
cp .env.example .env.local           # fill in your Cognito pool + API origin
npm run dev                          # dev server on port 3002
```

Open http://127.0.0.1:3002.

> [!NOTE]
> Working inside the Vectros monorepo (not a fork)? This app consumes the
> shared [`@vectros-ai/react`](https://github.com/vectros-ai/vectros-react)
> library as its **built output** via a workspace alias (`tsc` reads
> `dist/index.d.ts`, Vite/Vitest read `dist/index.mjs`) — build it first, and
> again after changing it: `npm run build -w @vectros-ai/react` from the
> monorepo root. In a standalone fork the library resolves from npm and no
> extra step is needed. (Consuming the package _source_ pulled its whole
> dependency graph into every test file and loaded a second `@types/react`;
> the built-dist alias + `resolve.dedupe` avoids both.)

> [!NOTE]
> The dev server is pinned to **port 3002** so it coexists with the Developer
> Portal (3000) and Admin App (3001). Cognito auth uses SRP (direct API calls to
> `cognito-idp.<region>.amazonaws.com`), not Hosted UI / OAuth redirect — there
> is no callback URL allow-list to update for localhost dev.

### Other commands

```bash
npm run build         # tsc --noEmit && vite build → dist/
npm run preview       # serve the production build locally
npm run lint          # ESLint
npm run typecheck     # TypeScript noEmit check
npm run format:check  # Prettier (check only — used by CI)
npm test              # Vitest run (CI mode)
npm run test:watch    # Vitest watch
```

## How to re-brand a fork

The re-brand surface is deliberately concentrated:

1. **[`src/brand.ts`](src/brand.ts)** — product name, support email, brand
   colors, admin-app URL, privacy/terms URLs. The MUI theme reads from here.
2. **[`src/i18n/messages.en.json`](src/i18n/messages.en.json)** — all
   user-facing copy. Re-word here, not in JSX.
3. **[`public/favicon.svg`](public/favicon.svg)** — drop in your icon.
4. **[`.env.example`](.env.example)** + your `.env.local` — point at your own
   Cognito pool + API origin.
5. **Hosting** — deploy `dist/` to your own static hosting (the reference
   deployment is S3 + CloudFront with the CSP/HSTS posture below set at the
   edge).

If you find yourself editing more than these, file an issue — that's a bug in
our separation of concerns.

## Security model

| Concern | Posture |
|---|---|
| **Context is unspoofable** | The active AppContext is the `context_id` claim baked into the `st_*` token by the per-context mint — never a request parameter. Switching context = swapping the token. A user cannot reach a context they aren't entitled to even by editing client state. |
| **Cognito tokens at rest** | Stored by Amplify in browser `localStorage` (default), mitigated by a strict CSP that blocks third-party + inline scripts. |
| **CSP** | Set at the CloudFront edge (not `<meta>` tags). Strict — no inline scripts, no third-party origins beyond Cognito + the Vectros API host. |
| **HSTS** | Preload-ready (`max-age=63072000; includeSubDomains; preload`) on the production distribution. |
| **No PII in logs** | The global `unhandledrejection` / `error` listeners log to `console.error` only — no email, name, or URL query params. |

## Project layout

```
ui/app-vectros-ai/
├── public/              # Static assets served at / (favicon)
├── src/
│   ├── api/             # SDK client wiring (one VectrosClient per tenant+context)
│   ├── auth/            # Thin re-export of @vectros-ai/react + the context provider
│   ├── components/      # Dialogs (add/edit document, folders), LookupPanel,
│   │                    # Markdown viewer, version history, model picker, …
│   ├── hooks/           # Inference streaming + model registry
│   ├── i18n/            # IntlProvider wrapper + the English catalog
│   ├── lib/             # queryClient, drainPages, schema/record/document helpers
│   ├── pages/
│   │   ├── protected/   # Home, Records (+detail/editor), Documents (+detail),
│   │   │                # Schemas (+detail), Search, AI workspace (chat/ask), Account
│   │   └── public/      # LoginPage, NotFoundPage
│   ├── test/            # Vitest setup + provider helpers
│   ├── App.tsx          # Router (Routes only; BrowserRouter is in main.tsx)
│   ├── brand.ts         # SINGLE SOURCE OF TRUTH for branding
│   ├── config.ts        # Runtime config — fail-fast on missing env
│   ├── main.tsx         # ReactDOM mount + Amplify config + minter wiring
│   └── theme.ts         # MUI theme (consumes brand.ts)
├── vite.config.ts
└── README.md
```

## Contributing back

This codebase is owned by Vectros and is **public** — hold every change to a
reference-grade bar (clear boundaries, comments on exported surfaces, DRY,
tested). PRs that erode the brand separation, security model, or plane split are
not welcome — those patterns are why the codebase is useful as a reference.
