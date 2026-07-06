/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ---------------------------------------------------------------------------
// Vite + Vitest configuration for app.vectros.ai (the data-plane suite).
//
// Dev server pinned to port 3002 so it coexists with ui/developer-portal
// (3000) and ui/admin-app (3001) during local dev. `strictPort: true` makes a
// port collision a hard failure (instead of silently incrementing) so a
// developer notices + fixes it rather than launching against an unexpected URL
// the Cognito allow-list hasn't been updated for.
//
// Source maps in production builds: ENABLED. We ship a strict CSP that blocks
// third-party scripts, so the .map files are only useful to anyone who can
// already read source. Debuggability of production errors >> the negligible
// obfuscation gain of stripping maps.
//
// optimizeDeps.include — MUI icons are individually exported as separate
// modules (`@mui/icons-material/AccountCircle`, etc.). Vite's default behavior
// discovers them lazily on first request and FORCES A PAGE RELOAD when new ones
// land mid-session, which trips a brief window where Amplify's session-restore
// hasn't completed (RequireAuth bounces to /login). Pre-including the icons the
// shell uses warms them at startup. Add to this list as new icon imports land.
// (The admin app's vite config carries the full incident write-up.)
// ---------------------------------------------------------------------------

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Consume @vectros-ai/react as its BUILT bundle (one module) — matches what
      // tsc reads (dist/index.d.ts). Importing the src tree instead pulled the
      // whole package + its dep graph into every vitest file (ballooning import
      // time → userEvent timing flakes) and loaded a 2nd @types/react. Run
      // `npm run build -w @vectros-ai/react` after changing the lib (tsup --watch
      // during active dev). Swapped for a registry pin at the public-release cut.
    },
    // The lib declares these as peer deps; with a built-dist alias the app and the
    // lib's externalized imports must resolve to ONE copy. Two copies break two
    // ways: duplicate React/Query/Intl/Router instances lose shared context
    // ("invalid hook call"; missing provider), and a duplicate aws-amplify/jose
    // means a test's `vi.mock(...)` targets a different copy than the lib imports.
    // Force a single instance of every shared runtime dependency.
    dedupe: [
      'react',
      'react-dom',
      '@mui/material',
      '@mui/icons-material',
      '@emotion/react',
      '@emotion/styled',
      '@tanstack/react-query',
      'react-intl',
      'react-router',
      'aws-amplify',
      'jose',
      'qrcode.react',
      '@vectros-ai/sdk',
    ],
  },
  optimizeDeps: {
    include: [
      '@mui/icons-material/AccountCircle',
      '@mui/icons-material/Add',
      '@mui/icons-material/ArrowBack',
      '@mui/icons-material/AutoAwesome',
      '@mui/icons-material/Close',
      '@mui/icons-material/DeleteOutline',
      '@mui/icons-material/Description',
      '@mui/icons-material/EditOutlined',
      '@mui/icons-material/FileDownload',
      '@mui/icons-material/Home',
      '@mui/icons-material/Menu',
      '@mui/icons-material/Refresh',
      '@mui/icons-material/Schema',
      '@mui/icons-material/Search',
      '@mui/icons-material/Send',
      '@mui/icons-material/Stop',
      '@mui/icons-material/TableRows',
      '@mui/icons-material/UploadFile',
    ],
  },
  server: {
    port: 3002,
    strictPort: true,
    host: '127.0.0.1',
  },
  preview: {
    port: 3002,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Bail loud on accidental large bundles — surface them in PR review,
    // not in post-deploy CDN-bill autopsies.
    chunkSizeWarningLimit: 600,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Headroom over the 5s default: each test file transitively imports the
    // @vectros-ai/react bundle (→ aws-amplify), a heavy parse, so userEvent-driven
    // form tests can exceed 5s on a contended runner. Generous timeout removes the
    // false timeouts without masking real failures (assertion errors still fail).
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
});
