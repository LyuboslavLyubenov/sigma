// Vitest workspace for the integration lane. Run with `vitest run --config vitest.integration.config.ts`.
// The unit project lives in vitest.config.ts (untouched). This file extends the root
// vitest.config.ts and adds the integration project on top, OR you can run it standalone
// and use projects to inherit `extends: true`.
//
// Wired plugins: reactRouter() — resolves virtual:react-router/server-build.
// Wired setupFiles: ./test/integration/polyfills.ts — installs workerd `caches` polyfill.
//
// No `globalSetup`: each test file bootstraps its own wrangler proxy lazily via
// `./test/integration/setup.ts:appFetch()` (see that file for why a single globalSetup proxy is
// not visible to vitest's per-file worker processes). Wiring a globalSetup that seeds a proxy no
// test reads was pure overhead, so it was removed (PR #177 review T-003).
import { defineConfig } from 'vitest/config';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);

function resolveOtelEsmRoot(): string {
  try {
    return path.join(path.dirname(require.resolve('@opentelemetry/api/package.json')), 'build/esm');
  } catch {
    // Fallback: when `require.resolve` fails (e.g. pnpm hoisting put the package
    // under a non-default path), walk the pnpm store and pick the highest-versioned
    // `@opentelemetry/api` directory. A deterministic semver-aware sort guarantees
    // the same input always resolves to the same output, even if the store ever
    // hoists more than one version of the package.
    const pnpmStore = path.join(repoRoot, 'node_modules/.pnpm');
    const candidates = readdirSync(pnpmStore)
      .filter((entry) => entry.startsWith('@opentelemetry+api@'))
      .map((entry) => {
        const version = entry.slice('@opentelemetry+api@'.length);
        return { entry, version };
      })
      .sort((a, b) => compareSemverDesc(a.version, b.version))
      .map(({ entry }) => path.join(pnpmStore, entry, 'node_modules/@opentelemetry/api'))
      .find((candidate) => existsSync(path.join(candidate, 'build/esm')));

    if (!candidates) {
      throw new Error('Unable to resolve @opentelemetry/api build/esm directory for integration tests');
    }

    return path.join(candidates, 'build/esm');
  }
}

/**
 * Compare two pnpm-store directory version segments, descending. The entries under
 * `node_modules/.pnpm/` are keyed as `<name>@<version>` where `<version>` is either plain semver
 * (`@opentelemetry+api@1.9.1`) or semver followed by a `_`-delimited peer-dep hash
 * (`vitest@4.1.7_@opentelemetry+api@1.9.1_@types+node@...`). `core()` strips the `_…` peer-dep
 * tail before comparing the numeric semver core so the sort is deterministic regardless of which
 * flavour a given entry uses (PR #177 review T-007: the old comment described a `(hash)` parens
 * flavour that does not occur in store dir names, only in resolved package.json deps).
 */
function compareSemverDesc(a: string, b: string): number {
  const core = (s: string) => s.replace(/_.*$/, '');
  const [aMajor, aMinor, aPatch] = core(a).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [bMajor, bMinor, bPatch] = core(b).split('.').map((n) => Number.parseInt(n, 10) || 0);
  if (aMajor !== bMajor) return bMajor - aMajor;
  if (aMinor !== bMinor) return bMinor - aMinor;
  return bPatch - aPatch;
}

const otelEsmRoot = resolveOtelEsmRoot();

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    alias: [
      // Workaround for @opentelemetry/api@1.9.1 — its ESM build uses extension-less
      // relative imports (`./baggage/utils`) which Node 24's strict ESM loader rejects.
      // Vite resolves the alias through its own resolver; vite-node uses it too.
      {
        find: /^@opentelemetry\/api\/build\/esm\/baggage\/utils$/,
        replacement: path.join(otelEsmRoot, 'baggage/utils.js'),
      },
      {
        find: /^@opentelemetry\/api\/build\/esm\/trace\/internal\/utils$/,
        replacement: path.join(otelEsmRoot, 'trace/internal/utils.js'),
      },
    ],
  },
  optimizeDeps: {
    include: ['@opentelemetry/api', 'ai', '@ai-sdk/openai'],
  },
  ssr: {
    noExternal: ['@opentelemetry/api', 'ai', '@ai-sdk/openai'],
  },
  // Note: there is intentionally NO top-level `server.deps.inline`. `vitest run` reads
  // `test.server.deps.inline` (below); the top-level `server` block configures Vite's dev
  // server, which is not involved when running tests. Defining the same list in both places
  // was duplicated config that could drift (PR #177 review T-005, "NO CODE DUPLICATION").
  test: {
    name: 'integration',
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    // `include` is already scoped to `test/integration/**`, so the unit tests under `app/**` and
    // `workers/**` can never be picked up here. The exclude list is kept as a defensive safety net:
    // if a future `include` widening (or a glob accident) ever let a worker test slip in, this list
    // blocks it from running twice — once in the unit lane and once here. Without the comment it
    // read as dead config (PR #177 review T-006, "NO DEAD CODE").
    exclude: [
      'app/**/*.test.ts',
      'workers/csv-rate-limit.test.ts',
      'workers/csp.test.ts',
      'workers/rate-limit.test.ts',
      'workers/cache-key.test.ts',
      'workers/app.cache.test.ts',
      'workers/aggregation-rate-limit.test.ts',
      'workers/assistant-rate-limit.test.ts',
      'workers/search-rate-limit.test.ts',
      'workers/request-log.test.ts',
      'workers/http.test.ts',
    ],
    setupFiles: ['./test/integration/polyfills.ts'],
    server: {
      deps: {
        inline: [/^@opentelemetry\/api/, /^@ai-sdk/, /^ai/, /^@sigma\//],
      },
    },
    // Try hard: tell vitest to bundle all of these.
    deps: {
      optimizer: {
        web: { enabled: true },
        ssr: { enabled: true },
      },
      interopDefault: true,
    },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
