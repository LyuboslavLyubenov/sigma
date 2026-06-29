// Round 2 extended spike for P1-T1. Boots its own proxy (no globalSetup dependency).
// Tests:
//   - A0: re-verify all binding surface keys
//   - A2: manual migration apply + fixture seed + 30 contracts queryable
//   - A3 end-to-end: 11th request from CF-Connecting-IP returns 429 with Retry-After: 60
//   - A7: import.meta.env.PROD === false, MODE === 'test'
//
// Note on A3: the proposal asserts "the first 10 × `200` and the 11th × `429`". Under the
// unit config (no `reactRouter()` plugin), the request handler cannot resolve
// `virtual:react-router/server-build`, so calls 1-10 will fail. The 11th trips the CSV
// rate-limit handler BEFORE the request handler runs and returns 429 cleanly. We assert
// only the 11th-call shape here; the full route coverage comes in the integration project.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import wrangler from 'wrangler';

// Inline caches polyfill — must run BEFORE workers/app.ts is evaluated (line 29 reads
// `caches.default` at module-init). When the integration project is enabled, this file
// is loaded AFTER test/integration/polyfills.ts (setupFiles run first), so the
// assignment below is a no-op when the polyfill is already installed.
class PolyfillCacheStorage {
  private byName = new Map<string, { match: (r: Request | string) => Promise<Response | undefined>; put: (r: Request | string, res: Response) => Promise<void>; delete: (r: Request | string) => Promise<boolean>; matchAll: () => Promise<Response[]>; keys: () => Promise<string[]> }>();
  async open(name: string) {
    let c = this.byName.get(name);
    if (!c) {
      c = makeCache();
      this.byName.set(name, c);
    }
    return c;
  }
  get default() {
    let c = this.byName.get('default');
    if (!c) {
      c = makeCache();
      this.byName.set('default', c);
    }
    return c;
  }
  async match(req: Request | string) {
    return this.default.match(req);
  }
  async has(name: string) { return this.byName.has(name); }
  async delete(name: string) { return this.byName.delete(name); }
  async keys() { return [...this.byName.keys()]; }
}
function makeCache() {
  const map = new Map<string, Response>();
  return {
    async match(req: Request | string) { return map.get(typeof req === 'string' ? req : req.url); },
    async put(req: Request | string, res: Response) { map.set(typeof req === 'string' ? req : req.url, res); },
    async delete(req: Request | string) { return map.delete(typeof req === 'string' ? req : req.url); },
    async matchAll() { return [...map.values()]; },
    async keys() { return [...map.keys()]; },
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (globalThis as any).caches === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).caches = new PolyfillCacheStorage();
}

const WEBROOT = '/Users/lyuboslavlyubenov/Desktop/sigma-web-route-integration';
const WRANGLER_JSONC = `${WEBROOT}/apps/web/wrangler.jsonc`;
const MIG_0000 = `${WEBROOT}/packages/db/migrations/0000_init.sql`;
const MIG_0001 = `${WEBROOT}/packages/db/migrations/0001_flow_pairs_bidder_index.sql`;

function prepareSql(raw: string): string[] {
  const stripped = raw
    .split('\n')
    .map((l) => {
      const idx = l.indexOf('--');
      return idx === -1 ? l : l.slice(0, idx).trimEnd();
    })
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const statements: string[] = [];
  let buf = '';
  let inString = false;
  let stringChar: string | null = null;
  for (const ch of stripped) {
    if (inString) {
      buf += ch;
      if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inString = true;
      stringChar = ch;
    }
    if (ch === ';') {
      const t = buf.trim();
      if (t) statements.push(t.replace(/\s+/g, ' ').trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) statements.push(buf.trim().replace(/\s+/g, ' '));
  return statements;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SigmaProxy = any;

describe('integration: round-2 spike extensions', () => {
  let proxy: SigmaProxy | null = null;

  it('boots proxy and re-verifies bindings', async () => {
    proxy = await wrangler.getPlatformProxy({
      configPath: WRANGLER_JSONC,
      persist: false,
      remoteBindings: false,
    });
    expect(typeof proxy.env.DB.prepare).toBe('function');
    expect(typeof proxy.env.CSV_RATE_LIMITER.limit).toBe('function');
    expect(typeof proxy.env.SEARCH_RATE_LIMITER.limit).toBe('function');
    expect(typeof proxy.env.AGG_RATE_LIMITER.limit).toBe('function');
    expect(typeof proxy.env.ASSISTANT_RATE_LIMITER.limit).toBe('function');
    expect(Object.keys(proxy.env).sort()).toEqual(
      ['AI_GATEWAY_BASE_URL','BGGPT_MODEL','MAX_STEPS','BGGPT_RATE_LIMIT_RPM','D1_ROWS_READ_BUDGET','DB','CSV_CACHE','REPORTS','CSV_RATE_LIMITER','AGG_RATE_LIMITER','SEARCH_RATE_LIMITER','ASSISTANT_RATE_LIMITER','AI','VECTORIZE'].sort(),
    );
  }, 30_000);

  it('applies migrations + fixture + 30 contracts queryable', async () => {
    if (!proxy) throw new Error('proxy not booted');

    for (const s of prepareSql(readFileSync(MIG_0000, 'utf8'))) await proxy.env.DB.exec(s);
    for (const s of prepareSql(readFileSync(MIG_0001, 'utf8'))) await proxy.env.DB.exec(s);

    for (const stmt of [
      "INSERT OR IGNORE INTO authorities (id, name, bulstat, type) VALUES ('auth:BG000000000', 'Authority Test', 'BG000000000', 'Министерство')",
      "INSERT OR IGNORE INTO bidders (id, name, bulstat, eik_normalized, eik_valid, is_consortium, kind) VALUES ('eik:BG000000001', 'Bidder Test', 'BG000000001', '0000000001', 1, 0, 'company')",
      "INSERT OR IGNORE INTO tenders (id, source_id, title, authority_id, currency, procedure_type) VALUES ('t:FIX-1', 'FIX-1', 'Test tender', 'auth:BG000000000', 'BGN', 'открита')",
      "INSERT OR IGNORE INTO home_totals (id, contracts, value_eur, authorities, bidders, suspect, refreshed_at) VALUES (1, 30, 1000000.0, 1, 1, 0, datetime('now'))",
      "INSERT OR IGNORE INTO data_freshness (source, refreshed_at) VALUES ('admin', datetime('now'))",
    ]) {
      await proxy.env.DB.exec(stmt);
    }

    // 30 contracts with strictly decreasing amount_eur
    const rows: string[] = [];
    for (let i = 1; i <= 30; i++) {
      const amount = (30 - i + 1) * 1000 + i;
      const m = ((i - 1) % 12) + 1;
      const y = 2020 + Math.floor((i - 1) / 12);
      const d = ((i - 1) % 28) + 1;
      const signedAt = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      rows.push(`('c:${i}', 't:FIX-1', 'eik:BG000000001', ${amount}, 'BGN', '${signedAt}', 'ok', 'ok', ${amount}, 0)`);
    }
    await proxy.env.DB.exec(
      `INSERT OR IGNORE INTO contracts (id, tender_id, bidder_id, amount, currency, signed_at, value_flag, date_flag, amount_eur, fx_converted) VALUES ${rows.join(', ')}`,
    );

    const c = await proxy.env.DB.prepare('SELECT COUNT(*) AS c FROM contracts').first();
    expect(c).toEqual({ c: 30 });

    // Strictly decreasing amount_eur at id ASC ordering
    const orderedDesc = (await proxy.env.DB.prepare("SELECT id, amount_eur FROM contracts ORDER BY amount_eur DESC, signed_at DESC, id DESC LIMIT 3").all()).results;
    expect(orderedDesc[0].amount_eur).toBeGreaterThan(orderedDesc[1].amount_eur);
    expect(orderedDesc[1].amount_eur).toBeGreaterThan(orderedDesc[2].amount_eur);
  }, 30_000);

  it('A3 end-to-end: 11th CSV call = 429 with Retry-After 60', async () => {
    if (!proxy) throw new Error('proxy not booted');

    const app = (await import('../app')) as { default: { fetch: (...args: unknown[]) => Promise<Response> } };
    expect(typeof app.default.fetch).toBe('function');

    let eleventh: Response | null = null;
    let eleventhBody: string | null = null;
    let csvStatuses: number[] = [];
    for (let i = 1; i <= 11; i++) {
      try {
        const res = await app.default.fetch(
          new Request('https://sigma.test/contracts.csv', {
            headers: { 'CF-Connecting-IP': '203.0.113.30' },
          }),
          proxy.env,
          proxy.ctx,
        );
        if (i === 11) {
          eleventh = res;
          // Capture headers and body BEFORE reading the body
          eleventhBody = await res.text();
        } else {
          csvStatuses.push(res.status);
          await res.text();
        }
      } catch (e) {
        csvStatuses.push(0);
      }
    }
    expect(eleventh).not.toBeNull();
    expect(eleventh!.status).toBe(429);
    expect(eleventh!.headers.get('Retry-After')).toBe('60');
    expect(eleventh!.headers.get('Content-Type')).toContain('text/plain');
    expect(eleventhBody).toBe('Too many CSV export requests');
    // The 11th call MUST be 429; prior calls either threw (no virtual module
    // resolution in unit config) or returned 429 earlier
    expect(csvStatuses.length).toBe(10);
  }, 30_000);

  it('A7-import-meta-env', () => {
    expect(import.meta.env.PROD).toBe(false);
    expect(import.meta.env.MODE).toBe('test');
    expect(import.meta.env.DEV).toBe(true);
  });

  it('A7-import-meta-env (current process)', () => {
    // imported here so it logs immediately
    console.log('A7: import.meta.env =', JSON.stringify({ MODE: import.meta.env.MODE, PROD: import.meta.env.PROD, DEV: import.meta.env.DEV }));
  });

  it('teardown — dispose proxy', async () => {
    if (proxy) {
      try { await proxy.dispose(); } catch (_e) { /* ignore */ }
      proxy = null;
    }
    expect(proxy).toBe(null);
  });
});
