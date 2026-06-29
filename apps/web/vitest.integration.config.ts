// Vitest workspace for the integration lane. Run with `vitest run --config vitest.integration.config.ts`.
// The unit project lives in vitest.config.ts (untouched). This file extends the root
// vitest.config.ts and adds the integration project on top, OR you can run it standalone
// and use projects to inherit `extends: true`.
//
// Wired plugins: reactRouter() — resolves virtual:react-router/server-build.
// Wired setupFiles: ./test/integration/polyfills.ts — installs workerd `caches` polyfill.
// Wired globalSetup: ./test/integration/global-setup.ts — boots proxy + applies migrations
//                                                           + seeds fixture + disposes.
import { defineConfig } from 'vitest/config';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const otelBaggageUtils = path.resolve(
  '/Users/lyuboslavlyubenov/Desktop/sigma-web-route-integration/node_modules/.pnpm/@opentelemetry+api@1.9.1/node_modules/@opentelemetry/api/build/esm/baggage/utils.js',
);

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    alias: [
      // Workaround for @opentelemetry/api@1.9.1 — its ESM build uses extension-less
      // relative imports (`./baggage/utils`) which Node 24's strict ESM loader rejects.
      // Vite resolves the alias through its own resolver; vite-node uses it too.
      {
        find: /^@opentelemetry\/api\/build\/esm\/baggage\/utils$/,
        replacement: otelBaggageUtils,
      },
      {
        find: /^@opentelemetry\/api\/build\/esm\/trace\/internal\/utils$/,
        replacement: '/Users/lyuboslavlyubenov/Desktop/sigma-web-route-integration/node_modules/.pnpm/@opentelemetry+api@1.9.1/node_modules/@opentelemetry/api/build/esm/trace/internal/utils.js',
      },
    ],
  },
  optimizeDeps: {
    include: ['@opentelemetry/api', 'ai', '@ai-sdk/openai'],
  },
  ssr: {
    noExternal: ['@opentelemetry/api', 'ai', '@ai-sdk/openai'],
  },
  server: {
    deps: {
      inline: [/^@opentelemetry\/api/, /^@ai-sdk/, /^ai/, /^@sigma\//],
    },
  },
  test: {
    name: 'integration',
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    exclude: [
      'app/**/*.test.ts',
      'test/integration/__archive__r2_spike__/**',
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
    globalSetup: ['./test/integration/global-setup.ts'],
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
